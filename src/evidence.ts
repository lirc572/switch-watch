import type { Source, SwitchHit } from "./types.ts";

/** Structured, rule-extracted evidence about a source page's promotions. */
export interface PageEvidence {
  /** Source id this evidence came from. */
  sourceId: string;
  /** Distinct promo codes / tokens seen on the page (e.g. SSAUG2, SSJUL5). */
  promoCodes: string[];
  /** ISO dates (YYYY-MM-DD) parsed from the page, when unambiguous. */
  dates: string[];
  /** Explicit expiry / validity phrases found near gift content. */
  expiryPhrases: string[];
  /** Years mentioned on the page (for quick staleness checks). */
  years: number[];
  /** Hostname of the source, to steer the model about trust level. */
  host: string;
}

const PROMO_CODE_RE = /\bSS[A-Z]{2,4}\d{0,3}\b/g;
const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const DATE_TEXT_RE =
  /\b(?:(\d{1,2})\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})?(?:st|nd|rd|th)?,?\s*(\d{4})\b/gi;

// Matches explicit ISO timestamps like 2026-09-30T15:59:00Z.
const ISO_DATE_RE = /\b(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}Z?)?\b/g;

const EXPIRY_RE =
  /\b(?:valid (?:until|till|through)|promotion period|apply (?:by|before)|expires?(?:\s+on)?|ends?(?:\s+on)?|from\s+\d{1,2}\s+\w+\s*(?:-|–|to)\s*)[^<.;]{0,80}/gi;

const YEAR_RE = /\b(20\d{2})\b/g;

/**
 * Pull rule-based evidence from a page body. This is cheap and deterministic;
 * it feeds the optional LLM analysis step with dates, promo codes and expiry
 * phrases so the model can judge whether an offer is current.
 */
export function extractEvidence(body: string, source: Source): PageEvidence {
  const text = body.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ");

  const promoCodes = uniq(
    [...text.matchAll(PROMO_CODE_RE)].map((m) => m[0].toUpperCase()),
  );

  const dates = new Set<string>();
  for (const m of text.matchAll(ISO_DATE_RE)) if (m[1]) dates.add(m[1]);
  for (const m of text.matchAll(DATE_TEXT_RE)) {
    const day = m[1] ? Number(m[1]) : m[3] ? Number(m[3]) : 1;
    const month = MONTHS[m[2]!.toLowerCase()];
    const year = Number(m[4]);
    if (month && year) dates.add(iso(year, month, day));
  }

  // Keep only dates in a plausible promotion window (last 2 years onward),
  // then cap the list so archive/nav dumps don't flood the prompt.
  const minYear = new Date().getUTCFullYear() - 2;
  const relevantDates = [...dates]
    .filter((d) => Number(d.slice(0, 4)) >= minYear)
    .sort()
    .slice(-30);

  const expiryPhrases = uniq(
    [...text.matchAll(EXPIRY_RE)]
      .map((m) => collapse(m[0]))
      // Require a digit so we keep real periods, not stray words.
      .filter((s) => /\d/.test(s) && s.length > 12),
  ).slice(0, 12);

  const years = uniq(
    [...text.matchAll(YEAR_RE)].map((m) => Number(m[1])),
  ).sort((a, b) => a - b);

  let host = "";
  try {
    host = new URL(source.url).host;
  } catch {
    host = "";
  }

  return {
    sourceId: source.id,
    promoCodes,
    dates: relevantDates,
    expiryPhrases,
    years,
    host,
  };
}

/** Attach evidence to hits from the same run, so reports are self-contained. */
export function withEvidence(
  hits: SwitchHit[],
  evidence: PageEvidence,
): Array<SwitchHit & { evidence: PageEvidence }> {
  return hits.map((h) => ({ ...h, evidence }));
}

function iso(y: number, m: number, d: number): string {
  const mm = String(m).padStart(2, "0");
  const maxDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(Math.max(d, 1), maxDay);
  const dd = String(day).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
