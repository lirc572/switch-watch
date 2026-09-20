import type { Change, SourceResult, SwitchHit } from "./types.ts";

/** Render a human-readable report for the console. */
export function renderTextReport(
  results: SourceResult[],
  changes: Change[],
): string {
  const lines: string[] = [];
  lines.push("switch-watch scan");
  lines.push("=================");
  for (const r of results) {
    const state = r.error ? `ERROR (${r.error})` : `ok ${r.status}`;
    const n = r.hits.length;
    lines.push(`- ${r.source.id} [${state}] hits=${n}`);
  }
  lines.push("");
  if (changes.length === 0) {
    lines.push("No new Nintendo Switch offers found.");
  } else {
    lines.push(`${changes.length} change(s) detected:`);
    for (const c of changes) {
      lines.push("");
      lines.push(`### ${c.sourceLabel} (${c.type})`);
      lines.push(`    ${c.url}`);
      for (const h of c.hits) lines.push(formatHit(h));
      if (c.hits.length === 0) lines.push("    (page content changed)");
    }
  }
  return lines.join("\n");
}

function formatHit(h: SwitchHit): string {
  const bits = [`    • ${h.match}`];
  if (h.kind && h.kind !== "unknown") bits.push(`[${h.kind}]`);
  if (h.price != null) bits.push(`S$${h.price}`);
  if (h.gift) bits.push(`(${h.gift})`);
  const out = [bits.join(" ")];
  out.push(`      ${truncate(h.context, 200)}`);
  return out.join("\n");
}

/** Render a GitHub-flavoured Markdown summary for `$GITHUB_STEP_SUMMARY`. */
export function renderMarkdownReport(
  results: SourceResult[],
  changes: Change[],
): string {
  const md: string[] = [];
  md.push("# 🎮 switch-watch report", "");
  md.push(`_${new Date().toISOString()}_`, "");

  md.push("## Sources", "");
  md.push("| source | status | switch hits |");
  md.push("| --- | --- | --- |");
  for (const r of results) {
    const state = r.error ? `❌ ${r.error}` : `✅ ${r.status}`;
    md.push(`| \`${r.source.id}\` | ${state} | ${r.hits.length} |`);
  }
  md.push("");

  const switches = changes.filter((c) => c.type === "new-hits");
  if (changes.length === 0) {
    md.push("## ✅ No new Nintendo Switch offers found", "");
    return md.join("\n");
  }

  if (switches.length > 0) md.push("## 🎮 New Nintendo Switch offers found!");
  else md.push("## ⚠️ Some watched pages changed");
  md.push("");

  for (const c of changes) {
    md.push(`### ${c.sourceLabel}`);
    md.push(`<${c.url}> (${c.type})`);
    md.push("");
    if (c.hits.length === 0) {
      md.push("_Page content changed — no Switch keyword yet._");
    } else {
      for (const h of c.hits) {
        const tags = [
          h.kind && h.kind !== "unknown" ? `\`${h.kind}\`` : "",
          h.price != null ? `**S$${h.price}**` : "",
          h.gift ? `\`${h.gift}\`` : "",
        ]
          .filter(Boolean)
          .join(" ");
        md.push(`- **${h.match}** ${tags}`);
        md.push(`  > ${truncate(h.context, 300)}`);
      }
    }
    md.push("");
  }
  return md.join("\n");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
