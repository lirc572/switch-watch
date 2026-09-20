import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { findSwitchHits } from "./detect.ts";
import { extractEvidence } from "./evidence.ts";
import type {
  Change,
  RunOptions,
  Source,
  SourceResult,
  WatchState,
} from "./types.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CONCURRENCY = 4;
const USER_AGENT =
  "Mozilla/5.0 (compatible; switch-watch/0.1; +https://github.com/)";

/** Load state from a JSON string, tolerating missing / corrupt files. */
export function parseState(json: string | undefined | null): WatchState {
  const empty: WatchState = {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    hashes: {},
    reported: [],
  };
  if (!json) return empty;
  try {
    const parsed = JSON.parse(json) as Partial<WatchState>;
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? empty.updatedAt,
      hashes: parsed.hashes ?? {},
      reported: Array.isArray(parsed.reported) ? parsed.reported : [],
    };
  } catch {
    return empty;
  }
}

/** Normalise a body before hashing so cosmetic whitespace churn doesn't alert. */
function normaliseForHash(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Detect anti-bot interstitial pages (Cloudflare, Akamai, etc.). These return a
 * 2xx but carry no real content, so treating them as success would overwrite a
 * good hash and later produce a spurious "changed" alert.
 */
function isChallengePage(body: string): boolean {
  if (body.length > 20_000) return false;
  return (
    /cf-browser-verification|cf_chl_|__cf_chl_|challenge-platform|cf-mitigated/i.test(
      body,
    ) ||
    /Just a moment\.\.\.|Attention Required!|Enable JavaScript and cookies to continue|Verifying you are human/i.test(
      body,
    ) ||
    /akamai bot manager|_abck|Incapsula incident id/i.test(body)
  );
}

/**
 * Extract searchable text from a PDF. Prefers `pdftotext` (poppler), which
 * decompresses content streams. Falls back to a latin1 decode of the raw bytes
 * so uncompressed metadata / bookmarks can still be matched when poppler is
 * unavailable.
 */
async function readPdf(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const text = await runPdftotext(bytes).catch((err: unknown) => {
    if (process.env.SWITCH_WATCH_DEBUG) {
      console.error(`[switch-watch] pdftotext unavailable: ${String(err)}`);
    }
    return undefined;
  });
  if (text && text.trim()) return text;
  return Buffer.from(bytes).toString("latin1");
}

function runPdftotext(bytes: Uint8Array): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const child = spawn("pdftotext", ["-layout", "-", "-"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    child.on("error", reject);
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
      else reject(new Error(`pdftotext exited ${code}`));
    });
    child.stdin.on("error", reject);
    child.stdin.end(Buffer.from(bytes));
  });
}

/**
 * Fetch one source and scan it for Switch mentions, retrying transient
 * failures (network errors, bot-challenge pages) a few times.
 */
export async function scanSource(
  source: Source,
  options: RunOptions = {},
): Promise<SourceResult> {
  const attempts = Math.max(1, options.retries ?? 2);
  let last: SourceResult | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await scanSourceOnce(source, options);
    if (!last.error) return last;
    if (attempt < attempts - 1) {
      await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
    }
  }
  return last!;
}

async function scanSourceOnce(
  source: Source,
  options: RunOptions = {},
): Promise<SourceResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const res = await fetchImpl(source.url, {
      redirect: "follow",
      headers: {
        accept:
          source.kind === "pdf"
            ? "application/pdf,*/*"
            : "text/html,application/xhtml+xml",
        "accept-language": "en-SG",
        "user-agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return {
        source,
        status: res.status,
        hash: "",
        hits: [],
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }
    const body =
      source.kind === "pdf"
        ? await readPdf(await res.arrayBuffer())
        : await res.text();
    if (source.kind === "html" && isChallengePage(body)) {
      return {
        source,
        status: res.status,
        hash: "",
        hits: [],
        error: `bot challenge page (HTTP ${res.status})`,
      };
    }
    const normalised = normaliseForHash(body);
    return {
      source,
      status: res.status,
      hash: sha256(normalised),
      hits: findSwitchHits(body, source),
      evidence: extractEvidence(body, source),
    };
  } catch (err) {
    return {
      source,
      status: 0,
      hash: "",
      hits: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Fetch every source with bounded concurrency. */
export async function scanAll(
  sources: readonly Source[],
  options: RunOptions = {},
): Promise<SourceResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const results: SourceResult[] = new Array(sources.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= sources.length) return;
      results[i] = await scanSource(sources[i]!, options);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, sources.length) }, worker),
  );
  return results;
}

/** Stable key identifying a hit across runs. */
export function hitKey(hit: { sourceId: string; match: string; gift?: string }): string {
  return `${hit.sourceId}:${hit.match.toLowerCase()}:${(hit.gift ?? "").toLowerCase()}`;
}

/**
 * Compare a fresh scan against the previous state and produce a list of
 * changes. A source yields "new-hits" when it carries Switch mentions not seen
 * before, and "changed" when only the body hash moved (opt-in per source).
 */
export function diff(
  results: SourceResult[],
  state: WatchState,
): { changes: Change[]; nextReported: string[] } {
  const reported = new Set(state.reported);
  const changes: Change[] = [];
  const nextReported = new Set(state.reported);

  for (const r of results) {
    if (r.error) continue;
    const fresh = r.hits.filter((h) => !reported.has(hitKey(h)));
    if (fresh.length > 0) {
      for (const h of fresh) nextReported.add(hitKey(h));
      changes.push({
        sourceId: r.source.id,
        sourceLabel: r.source.label,
        url: r.source.url,
        type: "new-hits",
        hits: fresh,
      });
      continue;
    }
    const previousHash = state.hashes[r.source.id];
    if (
      r.source.watchOnChange &&
      previousHash &&
      previousHash !== r.hash
    ) {
      changes.push({
        sourceId: r.source.id,
        sourceLabel: r.source.label,
        url: r.source.url,
        type: "changed",
        hits: r.hits,
      });
    }
  }

  return { changes, nextReported: [...nextReported] };
}

/** Fold scan results into the next persisted state. */
export function nextState(
  results: SourceResult[],
  state: WatchState,
  reported: string[],
): WatchState {
  const hashes = { ...state.hashes };
  for (const r of results) {
    if (!r.error && r.hash) hashes[r.source.id] = r.hash;
  }
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    hashes,
    reported,
  };
}
