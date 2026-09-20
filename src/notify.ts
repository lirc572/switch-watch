#!/usr/bin/env bun
/**
 * Open (or update) a GitHub issue when switch-watch finds new Switch offers.
 *
 * Reads a JSON report produced by `run.ts --json` and uses the GitHub REST API
 * with the workflow-provided `GITHUB_TOKEN`. No-ops when there is nothing new
 * or when not running inside GitHub Actions.
 */
import { readFile } from "node:fs/promises";

interface Change {
  sourceId: string;
  sourceLabel: string;
  url: string;
  type: "new-hits" | "changed";
  hits: Array<{
    match: string;
    context: string;
    gift?: string;
    kind?: string;
    price?: number;
  }>;
}

interface Report {
  scannedAt: string;
  changes: Change[];
}

const TITLE = "🎮 Nintendo Switch offer detected on SingSaver";

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

function buildBody(report: Report, runUrl?: string): string {
  const lines: string[] = [];
  lines.push("A new SingSaver credit-card promotion that mentions a **Nintendo Switch** was found.", "");
  for (const c of report.changes) {
    lines.push(`### ${c.sourceLabel}`);
    lines.push(`<${c.url}>`);
    lines.push("");
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
  lines.push(`_Scanned at ${report.scannedAt}._`);
  if (runUrl) lines.push(`_Run: ${runUrl}_`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const reportPath = process.argv[2] ?? "report.json";
  if (process.env.GITHUB_ACTIONS !== "true") {
    console.log("Not in GitHub Actions; skipping issue creation.");
    return;
  }
  const report = JSON.parse(await readFile(reportPath, "utf8")) as Report;
  const newHits = report.changes.filter((c) => c.type === "new-hits");
  if (newHits.length === 0) {
    console.log("No new Switch hits; nothing to report.");
    return;
  }

  const runUrl =
    process.env.GITHUB_SERVER_URL &&
    process.env.GITHUB_REPOSITORY &&
    process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined;
  const body = buildBody({ ...report, changes: newHits }, runUrl);

  // Reuse an existing open issue to avoid spamming one per cron tick.
  const search = await gh(
    `/issues?state=open&labels=switch-offer&per_page=10`,
    { method: "GET" },
  );
  const issues = (await search.json()) as Array<{ number: number; title: string }>;
  const existing = issues.find((i) => i.title === TITLE);

  if (existing) {
    const res = await gh(`/issues/${existing.number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error(`comment failed: ${res.status} ${await res.text()}`);
    console.log(`Commented on issue #${existing.number}`);
    return;
  }

  const res = await gh(`/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: TITLE,
      body,
      labels: ["switch-offer"],
    }),
  });
  if (!res.ok) throw new Error(`create failed: ${res.status} ${await res.text()}`);
  const created = (await res.json()) as { number: number; html_url: string };
  console.log(`Created issue #${created.number}: ${created.html_url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
