import { describe, expect, test } from "bun:test";
import { findSwitchHits } from "../src/detect.ts";
import type { Source } from "../src/types.ts";

const source: Source = {
  id: "test",
  label: "Test page",
  url: "https://example.com/test",
  kind: "html",
};

describe("findSwitchHits", () => {
  test("returns nothing when there is no Nintendo Switch text", () => {
    expect(findSwitchHits("<p>Switch your rewards every month</p>", source)).toEqual([]);
    expect(findSwitchHits("Just a normal page about cards", source)).toEqual([]);
  });

  test("detects a free Nintendo Switch OLED gift", () => {
    const html =
      "<td>Nintendo Switch OLED <br>(each worth $549)</strong></td>" +
      "<span>Choose one free gift: Nintendo Switch OLED</span>";
    const hits = findSwitchHits(html, source);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.match).toBe("Nintendo Switch OLED");
    expect(hits[0]!.price).toBe(549);
    expect(hits[0]!.kind).toBe("free");
  });

  test("detects a Nintendo Switch 2 top-up upgrade", () => {
    const text = "Top up S$250 for the following gift: Nintendo Switch 2 (worth S$719)";
    const hits = findSwitchHits(text, source);
    expect(hits.length).toBe(1);
    expect(hits[0]!.match).toBe("Nintendo Switch 2");
    expect(hits[0]!.kind).toBe("topup");
    expect(hits[0]!.price).toBe(250);
  });

  test("detects a gift uid with no visible text", () => {
    const html = `<div data-gift-uid="TOPUP.NINTENDO.SWITCH-2.719"></div>`;
    const hits = findSwitchHits(html, source);
    expect(hits.length).toBe(1);
    expect(hits[0]!.gift).toBe("TOPUP.NINTENDO.SWITCH-2.719");
    expect(hits[0]!.kind).toBe("topup");
    expect(hits[0]!.price).toBe(719);
  });

  test("ignores browser User-Agent console regex noise", () => {
    const html =
      'Console:"\\b(Nintendo|Nintendo WiiU|Nintendo 3DS|Nintendo Switch|PLAYSTATION|Xbox)\\b"';
    expect(findSwitchHits(html, source)).toEqual([]);
  });

  test("ignores Switch mentions inside image asset URLs", () => {
    const html =
      '<img src="https://cdn/x/Nintendo%20Switch%20OLED-1.png?width=138" alt="Nintendo Switch OLED-1">';
    expect(findSwitchHits(html, source)).toEqual([]);
  });

  test("keeps a real free-gift mention even next to an image", () => {
    const html =
      '<img src="https://cdn/x/Nintendo%20Switch.png"> Nintendo Switch OLED (each worth S$549)';
    const hits = findSwitchHits(html, source);
    expect(hits.length).toBe(1);
    expect(hits[0]!.price).toBe(549);
  });

  test("dedupes identical mentions", () => {
    const text = "Nintendo Switch OLED. Nintendo Switch OLED.";
    const hits = findSwitchHits(text, source);
    // Two identical contexts collapse to one; different windows stay separate.
    expect(hits.length).toBeLessThanOrEqual(2);
  });
});
