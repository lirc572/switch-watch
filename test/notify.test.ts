import { describe, expect, test } from "bun:test";
import { buildBody } from "../src/notify.ts";

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
    const body = buildBody(report as never);
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
    const body = buildBody(report as never);
    expect(body).toContain("### S");
    expect(body).toContain("Nintendo Switch");
    expect(body).not.toContain("LLM");
  });
});
