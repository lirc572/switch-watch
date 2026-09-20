import { describe, expect, test } from "bun:test";
import { extractEvidence } from "../src/evidence.ts";
import type { Source } from "../src/types.ts";

const source: Source = {
  id: "test",
  label: "Test",
  url: "https://www.singsaver.com.sg/campaign/foo",
  kind: "html",
};

describe("extractEvidence", () => {
  test("picks up promo codes and dates from a stale page", () => {
    const html =
      "<p>Promo code SSAUG2. Apply before Monday, September 30th, 2024.</p>" +
      "<p>Nintendo Switch OLED</p>";
    const ev = extractEvidence(html, source);
    expect(ev.promoCodes).toContain("SSAUG2");
    expect(ev.dates).toContain("2024-09-30");
    expect(ev.years).toContain(2024);
    expect(ev.host).toBe("www.singsaver.com.sg");
  });

  test("picks up ISO dates and current-year promo", () => {
    const html =
      "<script>{\"priceValidUntil\":\"2026-09-23T15:59:00Z\"}</script>" +
      "<p>Top up S$250 for Nintendo Switch 2</p>";
    const ev = extractEvidence(html, source);
    expect(ev.dates).toContain("2026-09-23");
    expect(ev.years).toContain(2026);
  });

  test("captures expiry phrases", () => {
    const html = "<p>Valid until 31 March 2026. Promotion Period: 1-31 Mar 2026</p>";
    const ev = extractEvidence(html, source);
    expect(ev.expiryPhrases.length).toBeGreaterThan(0);
  });
});
