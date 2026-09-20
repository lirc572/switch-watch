import type { Source, SwitchHit } from "./types.ts";

/** Matches "Nintendo Switch", "Nintendo Switch 2", "Nintendo Switch OLED". */
const SWITCH_RE =
  /nintendo[\s\u00a0-]*switch(?:\s*(?:2|oled|lite))?/gi;

/** Matches gift uids such as `TOPUP.NINTENDO.SWITCH-2.719` or `NINTENDO.SWITCH.719`. */
const GIFT_UID_RE =
  /(?:TOPUP\.)?NINTENDO[._-][A-Z0-9._-]*SWITCH[A-Z0-9._-]*/gi;

/** Matches SGD prices like "S$719", "$719", "SGD 719". */
const PRICE_RE = /(?:S\$|SGD\s*|\$)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;

/**
 * Extract every distinct Nintendo Switch mention from a page body.
 *
 * @param body    Raw HTML or decoded PDF text.
 * @param source  The source the body came from.
 */
export function findSwitchHits(body: string, source: Source): SwitchHit[] {
  if (!body) return [];
  const lower = body.toLowerCase();
  if (!lower.includes("switch") || !lower.includes("nintendo")) return [];

  const hits: SwitchHit[] = [];
  const seen = new Set<string>();

  for (const m of body.matchAll(SWITCH_RE)) {
    const start = m.index ?? 0;
    const context = contextAround(body, start, m[0].length);
    const match = normaliseMatch(m[0]);
    const key = `${source.id}:${match}:${context.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const hit: SwitchHit = {
      sourceId: source.id,
      sourceLabel: source.label,
      url: source.url,
      match,
      context,
      kind: classify(context),
    };
    if (isImageOnlyContext(context)) continue;
    if (isNoiseContext(context)) continue;
    const gift = extractGiftUid(context);
    if (gift) hit.gift = gift;
    const price = extractPrice(context);
    if (price != null) hit.price = price;
    hits.push(hit);
  }

  // Some pages only expose the gift as a uid (no visible text). Capture those.
  for (const m of body.matchAll(GIFT_UID_RE)) {
    const gift = m[0];
    const key = `${source.id}:uid:${gift}`;
    if (seen.has(key)) continue;
    if (hits.some((h) => h.gift?.toUpperCase() === gift.toUpperCase())) continue;
    seen.add(key);
    const price = extractPriceFromUid(gift);
    const hit: SwitchHit = {
      sourceId: source.id,
      sourceLabel: source.label,
      url: source.url,
      match: "Nintendo Switch",
      context: gift,
      gift,
      kind: /^TOPUP/i.test(gift) ? "topup" : "unknown",
    };
    if (price != null) hit.price = price;
    hits.push(hit);
  }

  return dedupeHits(hits);
}

function normaliseMatch(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
  return cleaned.replace(/\b\w/, (c) => c.toUpperCase());
}

function contextAround(body: string, index: number, length: number): string {
  const before = Math.max(0, index - 160);
  const after = Math.min(body.length, index + length + 160);
  return body
    .slice(before, after)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractGiftUid(context: string): string | undefined {
  const m = context.match(GIFT_UID_RE);
  return m ? m[0] : undefined;
}

/**
 * True when the surrounding text is essentially an asset URL / alt attribute,
 * e.g. a product image path. Such matches carry no offer information.
 */
function isImageOnlyContext(context: string): boolean {
  const withoutUrls = context
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/\balt="[^"]*"/gi, "")
    .replace(/[\w%.-]+\/(?:hs-fs|hubfs)\/\S*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  // After stripping URLs there must still be a visible-label Switch mention.
  return !/nintendo[\s-]*switch/i.test(withoutUrls);
}

/**
 * Filters out matches that come from source code rather than real offers, e.g.
 * browser User-Agent regexes listing game consoles, or `<meta>` keyword dumps.
 */
function isNoiseContext(context: string): boolean {
  const c = context;
  // Console-detection regexes usually list several platforms together.
  const consoleCluster =
    /playstation/i.test(c) || /xbox/i.test(c) || /nintendo\s*wiiu/i.test(c);
  const looksLikeRegex = /\\b\(|\[\\w|\|[A-Za-z]+\|/.test(c);
  if (consoleCluster && looksLikeRegex) return true;
  // SerpAPI / analytics payloads and UA strings.
  if (/user-?agent|serpapi|mozilla\/|WebKit"/i.test(c) && looksLikeRegex) return true;
  return false;
}

function extractPrice(text: string): number | undefined {
  const m = text.match(PRICE_RE);
  if (!m?.[1]) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse a trailing SGD value from a gift uid such as `TOPUP.NINTENDO.SWITCH-2.719`
 * or `NINTENDO.SWITCH-2.719[250]`. Ignores model numbers by preferring a
 * bracketed top-up amount, then the last dotted segment of 3-4 digits.
 */
function extractPriceFromUid(uid: string): number | undefined {
  const bracket = uid.match(/\[(\d+)\]\s*$/);
  if (bracket?.[1]) return Number(bracket[1]);
  const parts = uid.split(".");
  const last = parts[parts.length - 1];
  const m = last?.match(/(\d{2,5})$/);
  if (!m?.[1]) return undefined;
  return Number(m[1]);
}

function classify(context: string): SwitchHit["kind"] {
  const c = context.toLowerCase();
  if (/top[\s-]?up|topup/.test(c)) return "topup";
  if (/free|welcome gift|redeem|reward|choose from|gift of choice/.test(c)) {
    return "free";
  }
  return "unknown";
}

function dedupeHits(hits: SwitchHit[]): SwitchHit[] {
  // Collapse hits that describe the same gift, keeping the richest context
  // (the one that carries a price or a free/top-up classification).
  const byKey = new Map<string, SwitchHit>();
  for (const h of hits) {
    const key = `${h.match}|${h.gift ?? ""}`;
    const existing = byKey.get(key);
    if (!existing || score(h) > score(existing)) byKey.set(key, h);
  }
  return [...byKey.values()];
}

function score(h: SwitchHit): number {
  let s = h.context.length > 40 ? 1 : 0;
  if (h.price != null) s += 2;
  if (h.kind && h.kind !== "unknown") s += 2;
  if (h.gift) s += 1;
  return s;
}
