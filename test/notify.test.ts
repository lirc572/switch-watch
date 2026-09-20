import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildBody, shouldNotify } from "../src/notify.ts";

const base = {
  scannedAt: "2026-09-20T00:00:00.000Z",
};

describe("notify buildBody", () => {
  test("groups live findings in the body and hides stale ones in a details block", () => {
    const report = {
      ...base,
      changes: [
        {
          sourceId: "live",
          sourceLabel: "Live source",
          url: "https://x/live",
          type: "new-hits" as const,
          hits: [{ match: "Nintendo Switch 2", context: "free gift" }],
        },
        {
          sourceId: "stale",
          sourceLabel: "Stale source",
          url: "https://x/stale",
          type: "new-hits" as const,
          hits: [{ match: "Nintendo Switch OLED", context: "2024 promo" }],
        },
      ],
      analyses: [
        {
          sourceId: "live",
          url: "https://x/live",
          valid: true,
          reason: "current",
          promoPeriod: "June 2026",
          confidence: 0.9,
        },
        {
          sourceId: "stale",
          url: "https://x/stale",
          valid: false,
          reason: "expired 2024",
          promoPeriod: "Sep 2024",
        },
      ],
    };
    const body = buildBody(report);
    expect(body).toContain("LLM: likely valid");
    expect(body).toContain("June 2026");
    expect(body).toContain("Judged stale");
    expect(body).toContain("expired 2024");
    // The stale source's heading should not be in the top-level list.
    expect(body.indexOf("### Stale source")).toBe(-1);
  });

  test("renders plain findings when no analyses are present", () => {
    const report = {
      ...base,
      changes: [
        {
          sourceId: "s",
          sourceLabel: "S",
          url: "https://x/s",
          type: "new-hits" as const,
          hits: [{ match: "Nintendo Switch", context: "gift" }],
        },
      ],
    };
    const body = buildBody(report);
    expect(body).toContain("### S");
    expect(body).toContain("Nintendo Switch");
    expect(body).not.toContain("LLM");
  });

  test("unknown and failed analyses still notify, including legacy error records", () => {
    const report = {
      ...base,
      changes: [{
        sourceId: "s", sourceLabel: "S", url: "https://x/s", type: "new-hits" as const,
        hits: [{ match: "Nintendo Switch", context: "possible gift" }],
      }],
    };
    expect(shouldNotify(report)).toBe(true);
    for (const verdict of [
      { valid: null, reason: "Missing dates" },
      { valid: null, reason: "Copilot timed out", error: true },
      { valid: false, reason: "LLM HTTP 401", error: true },
    ]) {
      const enriched = { ...report, analyses: [{ sourceId: "s", url: "https://x/s", ...verdict }] };
      expect(shouldNotify(enriched)).toBe(true);
      expect(buildBody(enriched)).toContain("Unverified");
      expect(buildBody(enriched)).not.toContain("Judged stale");
    }
    expect(shouldNotify({ ...report, analyses: [{
      sourceId: "s", url: "https://x/s", valid: false, reason: "Expired September 2024",
    }] })).toBe(false);
    expect(shouldNotify({ ...base, changes: [] })).toBe(false);
    expect(shouldNotify({ ...report, changes: [{ ...report.changes[0]!, type: "changed" }] })).toBe(false);
  });
});

test("notification failure exits nonzero so CI cannot commit reported keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "switch-watch-notify-test-"));
  try {
    const preload = join(dir, "mock-github.ts");
    const reportPath = join(dir, "report.json");
    await writeFile(preload, 'globalThis.fetch = async () => new Response("Forbidden (offline test)", {status: 403});');
    const report = {
      ...base,
      changes: [{
        sourceId: "s", sourceLabel: "S", url: "https://example.invalid", type: "new-hits",
        hits: [{ match: "Nintendo Switch", context: "possible gift" }],
      }],
    };
    for (const stale of [false, true]) {
      await writeFile(reportPath, JSON.stringify({
        ...report,
        analyses: stale ? [{ sourceId: "s", url: "https://example.invalid", valid: false, reason: "Expired" }] : [],
      }));
      const child = Bun.spawn([
        process.execPath, "--preload", preload, resolve("src/notify.ts"), reportPath,
      ], {
        env: { PATH: process.env.PATH, GITHUB_ACTIONS: "true", GITHUB_TOKEN: "offline-test-token", GITHUB_REPOSITORY: "test/repo" },
        stdout: "pipe", stderr: "pipe",
      });
      const [code, stderr] = await Promise.all([
        child.exited, new Response(child.stderr).text(), new Response(child.stdout).text(),
      ]);
      expect(code).toBe(stale ? 0 : 1);
      if (!stale) expect(stderr).toContain("403");
      expect(stderr).not.toContain("offline-test-token");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
