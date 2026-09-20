#!/usr/bin/env bun
/**
 * Open (or update) a GitHub issue when switch-watch finds new Switch offers.
 *
 * Reads a JSON report produced by `run.ts --report` (optionally enriched by
 * `analyze.ts` with LLM verdicts) and uses the GitHub REST API with the
 * workflow-provided `GITHUB_TOKEN`. No-ops when there is nothing new or when
 * not running inside GitHub Actions.
 */
import { readFile } from "node:fs/promises";

interface Hit {
  match: string;
  context: string;
  gift?: string;
  kind?: string;
  price?: number;
}

interface Change {
  sourceId: string;
  sourceLabel: string;
  url: string;
  type: "new-hits" | "changed";
  hits: Hit[];
}

interface Analysis {
  sourceId: string;
  url: string;
  valid: boolean;
  reason: string;
  promoPeriod?: string;
  cards?: string[];
  conditions?: string[];
  confidence?: number;
  error?: boolean;
}

interface Report {
  scannedAt: string;
  changes: Change[];
  analyses?: Analysis[];
}

const TITLE = "🎮 Nintendo Switch offer detected on SingSaver";
const LABEL = "switch-offer";

async function gh(path: string, init: RequestInit): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) throw new Error("GITHUB_TOKEN / GITHUB_REPOSITORY missing");
  return fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export function buildBody(report: Report, runUrl?: string): string {
  const lines: string[] = [];
  lines.push(
    "A new SingSaver promotion that mentions a **Nintendo Switch** was found.",
    "",
  );

  const analyses = report.analyses ?? [];
  const judged = (c: Change) => analyses.find((a) => a.sourceId === c.sourceId);
  const isStale = (c: Change) => judged(c)?.valid === false;
  const live = report.changes.filter((c) => !isStale(c));
  const dead = report.changes.filter(isStale);

  for (const c of live) {
    const a = judged(c);
    lines.push(`### ${c.sourceLabel}`);
    lines.push(`<${c.url}>`);
    lines.push("");
    if (a?.valid === true) {
      const badge = a.confidence != null ? ` (confidence ${a.confidence})` : "";
      lines.push(`✅ **LLM: likely valid**${badge}${a.reason ? ` — ${a.reason}` : ""}`);
      if (a.promoPeriod) lines.push(`- Promo period: ${a.promoPeriod}`);
      if (a.cards?.length) lines.push(`- Cards: ${a.cards.join(", ")}`);
      if (a.conditions?.length) lines.push(`- Conditions: ${a.conditions.join("; ")}`);
      lines.push("");
    }
    if (c.hits.length === 0) {
      lines.push("_Page content changed (no Switch keyword yet)._");
    } else {
      for (const h of c.hits) {
        const meta = [
          h.kind && h.kind !== "unknown" ? `\`${h.kind}\`` : "",
          h.price != null ? `**S$${h.price}**` : "",
          h.gift ? `\`${h.gift}\`` : "",
        ]
          .filter(Boolean)
          .join(" ");
        lines.push(`- **${h.match}** ${meta}`);
        lines.push(`  > ${h.context}`);
      }
    }
    lines.push("");
  }

  if (dead.length > 0) {
    lines.push("<details><summary>❌ Judged stale / not currently valid</summary>", "");
    for (const c of dead) {
      const a = judged(c);
      lines.push(`- **${c.sourceLabel}** — ${a?.reason || "not valid"}`);
      if (a?.promoPeriod) lines.push(`  - promo period: ${a.promoPeriod}`);
    }
    lines.push("", "</details>", "");
  }

  lines.push(`_Scanned at ${report.scannedAt}._`);
  if (runUrl) lines.push(`_Run: ${runUrl}_`);
  return lines.join("\n");
}

async function ensureLabel(): Promise<void> {
  // Creating a label is idempotent-ish: 201 when created, 422 when it exists.
  const res = await gh(`/labels`, {
    method: "POST",
    body: JSON.stringify({
      name: LABEL,
      color: "e11d48",
      description: "A Nintendo Switch credit-card offer was detected",
    }),
  });
  if (!res.ok && res.status !== 422) {
    console.error(`could not ensure label: ${res.status}`);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}

async function main(): Promise<void> {
  const reportPath = process.argv[2] ?? "report.json";
  if (process.env.GITHUB_ACTIONS !== "true") {
    console.log("Not in GitHub Actions; skipping issue creation.");
    return;
  }
  const report = JSON.parse(await readFile(reportPath, "utf8")) as Report;
  const newHits = report.changes.filter((c) => c.type === "new-hits");

  // If the LLM judged every new hit stale, don't open an issue at all.
  const analyses = report.analyses ?? [];
  const anythingLive = newHits.some(
    (c) => analyses.find((a) => a.sourceId === c.sourceId)?.valid !== false,
  );
  if (newHits.length === 0) {
    console.log("No new Switch hits; nothing to report.");
    return;
  }
  if (!anythingLive && analyses.length > 0) {
    console.log("All new hits were judged stale by the LLM; skipping issue.");
    return;
  }

  const runUrl =
    process.env.GITHUB_SERVER_URL &&
    process.env.GITHUB_REPOSITORY &&
    process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined;
  const body = buildBody({ ...report, changes: newHits }, runUrl);

  await ensureLabel();

  const search = await gh(
    `/issues?state=open&labels=${LABEL}&per_page=10`,
    { method: "GET" },
  );
  if (!search.ok) {
    throw new Error(`list issues failed: ${search.status} ${await safeText(search)}`);
  }
  const issues = (await search.json()) as Array<{ number: number; title: string }>;
  const existing = issues.find((i) => i.title === TITLE);

  if (existing) {
    const res = await gh(`/issues/${existing.number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error(`comment failed: ${res.status} ${await safeText(res)}`);
    console.log(`Commented on issue #${existing.number}`);
    return;
  }

  const res = await gh(`/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: TITLE,
      body,
      labels: [LABEL],
    }),
  });
  if (!res.ok) throw new Error(`create failed: ${res.status} ${await safeText(res)}`);
  const created = (await res.json()) as { number: number; html_url: string };
  console.log(`Created issue #${created.number}: ${created.html_url}`);
}

main().catch((err) => {
  // Never fail the whole workflow just because alerting failed; the job summary
  // and annotations have already reported the finding, and state must persist.
  console.error(`notify failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(0);
});
