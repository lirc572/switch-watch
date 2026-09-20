#!/usr/bin/env bun
/**
 * Optional LLM analysis of switch-watch findings.
 *
 * Reads a report produced by `run.ts --report`, asks an OpenAI-compatible chat
 * model whether each Nintendo Switch finding is a *currently valid* promotion,
 * and writes the verdicts back into the report (and a Markdown summary).
 *
 * Configuration (all optional — the step no-ops without a key):
 *   LLM_API_KEY   API key. Falls back to OPENAI_API_KEY.
 *   LLM_BASE_URL  Base URL, default https://api.openai.com/v1
 *   LLM_MODEL     Model id, default gpt-4o-mini
 *
 * Usage:
 *   bun run src/analyze.ts report.json [--out report.json] [--summary path]
 */
import { readFile, writeFile } from "node:fs/promises";

interface Evidence {
  promoCodes: string[];
  dates: string[];
  expiryPhrases: string[];
  years: number[];
  host: string;
}

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
  type: string;
  hits: Hit[];
  evidence?: Evidence;
}

interface Report {
  scannedAt: string;
  changes: Change[];
  analyses?: Analysis[];
}

interface Analysis {
  sourceId: string;
  url: string;
  /** Whether the offer appears to be a currently valid promotion. */
  valid: boolean;
  /** Short justification. */
  reason: string;
  /** Promotion period as stated on the page, if found. */
  promoPeriod?: string;
  /** Credit cards involved, if stated. */
  cards?: string[];
  /** Key conditions / spend requirements. */
  conditions?: string[];
  /** Model confidence 0..1. */
  confidence?: number;
  /** True when the model call failed and this is a placeholder. */
  error?: boolean;
}

interface LlmVerdict {
  valid: boolean;
  reason: string;
  promoPeriod?: string;
  cards?: string[];
  conditions?: string[];
  confidence?: number;
}

const SYSTEM_PROMPT = `You are an analyst checking whether a Singapore credit-card promotion that offers a Nintendo Switch is CURRENTLY VALID.

You will receive: a source URL, the page's host, gift evidence (promo codes, dates, expiry phrases, years), and text snippets around the "Nintendo Switch" mentions.

Judge whether the promotion is live as of today. TODAY is provided in the user message.

Key rules:
- If the evidence contains only past dates (e.g. a September 2024 promo period) and nothing suggests a current window, mark valid=false with reason "expired".
- A page that merely still displays an old gift table does NOT mean the promo is live.
- If a concrete future/ongoing promo period is present, mark valid=true.
- If there is insufficient date information, be conservative: valid=true only if the language looks like a current call-to-action, else valid=false with reason "unclear".
- Third-party trackers (e.g. milelion.com, sethisfy.com) are secondary sources; treat their content as indicative, not authoritative.

Respond with ONLY a JSON object matching:
{"valid": boolean, "reason": string, "promoPeriod": string?, "cards": string[]?, "conditions": string[]?, "confidence": number}
No markdown, no prose outside the JSON.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reportPath = args.find((a) => !a.startsWith("--")) ?? "report.json";
  const outPath = readFlag(args, "--out") ?? reportPath;
  const summaryPath = readFlag(args, "--summary");

  const apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL ?? "gpt-4o-mini";

  const report = JSON.parse(await readFile(reportPath, "utf8")) as Report;
  const changes = report.changes.filter((c) => c.hits.length > 0);

  if (!apiKey) {
    console.log("LLM_API_KEY not set; skipping analysis.");
    if (summaryPath) {
      await writeFile(summaryPath, "## 🤖 LLM analysis\n\n_Skipped (no LLM_API_KEY)._\n");
    }
    return;
  }
  if (changes.length === 0) {
    console.log("No Switch findings to analyze.");
    if (summaryPath) {
      await writeFile(summaryPath, "## 🤖 LLM analysis\n\n_Nothing to analyze._\n");
    }
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const analyses: Analysis[] = [];
  for (const c of changes) {
    analyses.push(await analyzeChange(c, { apiKey, baseUrl, model, today }));
  }
  report.analyses = analyses;

  await writeFile(outPath, JSON.stringify(report, null, 2) + "\n");

  if (summaryPath) {
    await writeFile(summaryPath, renderSummary(analyses) + "\n");
  }
  console.log(`Analyzed ${analyses.length} finding(s).`);
  for (const a of analyses) {
    console.log(`- ${a.sourceId}: valid=${a.valid} (${a.reason})`);
  }
}

function readFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function analyzeChange(
  c: Change,
  cfg: { apiKey: string; baseUrl: string; model: string; today: string },
): Promise<Analysis> {
  const user = buildUserPrompt(c, cfg.today);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return { sourceId: c.sourceId, url: c.url, valid: false, reason: `LLM HTTP ${res.status}`, error: true };
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const verdict = parseVerdict(content);
    return { sourceId: c.sourceId, url: c.url, ...verdict };
  } catch (err) {
    return {
      sourceId: c.sourceId,
      url: c.url,
      valid: false,
      reason: `LLM error: ${err instanceof Error ? err.message : String(err)}`,
      error: true,
    };
  }
}

function buildUserPrompt(c: Change, today: string): string {
  const lines: string[] = [];
  lines.push(`TODAY: ${today}`);
  lines.push(`SOURCE: ${c.sourceLabel}`);
  lines.push(`URL: ${c.url}`);
  lines.push(`HOST: ${c.evidence?.host ?? "(unknown)"}`);
  lines.push("");
  if (c.evidence) {
    lines.push("EVIDENCE:");
    lines.push(`- promo codes: ${c.evidence.promoCodes.join(", ") || "(none)"}`);
    lines.push(`- dates on page: ${c.evidence.dates.join(", ") || "(none)"}`);
    lines.push(`- years on page: ${c.evidence.years.join(", ") || "(none)"}`);
    lines.push(
      `- expiry phrases: ${c.evidence.expiryPhrases.join(" | ") || "(none)"}`,
    );
    lines.push("");
  }
  lines.push("NINTENDO SWITCH MENTIONS:");
  for (const h of c.hits.slice(0, 5)) {
    const meta = [h.kind, h.price != null ? `S$${h.price}` : "", h.gift ?? ""]
      .filter(Boolean)
      .join(" ");
    lines.push(`- ${h.match} ${meta}`.trim());
    lines.push(`  context: ${h.context.slice(0, 400)}`);
  }
  return lines.join("\n");
}

function parseVerdict(content: string): LlmVerdict {
  const json = extractJson(content);
  if (!json) return { valid: false, reason: "unparseable LLM response" };
  return {
    valid: Boolean(json.valid),
    reason: typeof json.reason === "string" ? json.reason : "",
    promoPeriod: typeof json.promoPeriod === "string" ? json.promoPeriod : undefined,
    cards: Array.isArray(json.cards) ? json.cards.map(String) : undefined,
    conditions: Array.isArray(json.conditions) ? json.conditions.map(String) : undefined,
    confidence: typeof json.confidence === "number" ? json.confidence : undefined,
  };
}

function extractJson(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function renderSummary(analyses: Analysis[]): string {
  const md: string[] = ["## 🤖 LLM analysis", ""];
  for (const a of analyses) {
    const badge = a.error ? "⚠️" : a.valid ? "✅ valid" : "❌ not valid";
    md.push(`### ${badge} — ${a.sourceId}`);
    md.push(`<${a.url}>`);
    md.push("");
    md.push(a.reason || "(no reason given)");
    if (a.promoPeriod) md.push(`- **Promo period:** ${a.promoPeriod}`);
    if (a.cards?.length) md.push(`- **Cards:** ${a.cards.join(", ")}`);
    if (a.conditions?.length) md.push(`- **Conditions:** ${a.conditions.join("; ")}`);
    if (a.confidence != null) md.push(`- **Confidence:** ${a.confidence}`);
    md.push("");
  }
  return md.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
