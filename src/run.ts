#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { SOURCES, TERMS_SOURCES, TRACKER_SOURCES } from "./sources.ts";
import { renderMarkdownReport, renderTextReport } from "./report.ts";
import type { RunOptions, Source } from "./types.ts";
import { diff, nextState, parseState, scanAll } from "./watch.ts";

interface CliOptions extends RunOptions {
  statePath: string;
  outPath?: string;
  summaryPath?: string;
  json: boolean;
  includeTerms: boolean;
  /** Exit non-zero when new Switch hits are found (for CI gating). */
  failOnHit: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    statePath: "data/state.json",
    json: false,
    includeTerms: true,
    failOnHit: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [key, inline] = arg.includes("=")
      ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]
      : [arg, undefined];
    const value = (): string => {
      if (inline !== undefined) return inline;
      return argv[++i] ?? "";
    };
    switch (key) {
      case "--state":
        opts.statePath = value();
        break;
      case "--out":
        opts.outPath = value();
        break;
      case "--summary":
        opts.summaryPath = value();
        break;
      case "--timeout":
        opts.timeoutMs = Number(value());
        break;
      case "--concurrency":
        opts.concurrency = Number(value());
        break;
      case "--json":
        opts.json = true;
        break;
      case "--no-terms":
        opts.includeTerms = false;
        break;
      case "--fail-on-hit":
        opts.failOnHit = true;
        break;
    }
  }
  return opts;
}

async function readState(path: string) {
  try {
    return parseState(await readFile(path, "utf8"));
  } catch {
    return parseState(null);
  }
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const sources: Source[] = [
    ...SOURCES,
    ...TRACKER_SOURCES,
    ...(opts.includeTerms ? TERMS_SOURCES : []),
  ];

  const state = await readState(opts.statePath);
  const results = await scanAll(sources, opts);
  const { changes, nextReported } = diff(results, state);
  const newHits = changes.filter((c) => c.type === "new-hits");

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          scannedAt: new Date().toISOString(),
          sources: results.map((r) => ({
            id: r.source.id,
            status: r.status,
            error: r.error,
            hits: r.hits.length,
          })),
          changes,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(renderTextReport(results, changes));
  }

  if (opts.summaryPath) {
    await writeFile(
      opts.summaryPath,
      renderMarkdownReport(results, changes) + "\n",
    );
  }

  const updated = nextState(results, state, nextReported);
  await writeFile(opts.outPath ?? opts.statePath, JSON.stringify(updated, null, 2) + "\n");

  // Emit GitHub Actions annotations when running in CI.
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const c of newHits) {
      for (const h of c.hits) {
        console.log(
          `::warning title=Nintendo Switch offer::${h.match} — ${h.sourceLabel} (${h.url})`,
        );
      }
    }
    if (newHits.length > 0) {
      const names = newHits
        .flatMap((c) => c.hits.map((h) => h.match))
        .join(", ");
      console.log(`::notice title=switch-watch::New Switch offers: ${names}`);
    }
  }

  return opts.failOnHit && newHits.length > 0 ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
