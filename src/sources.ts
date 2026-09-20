import type { Source } from "./types.ts";

/** Site origin used for all SingSaver sources. */
const ORIGIN = "https://www.singsaver.com.sg";

/**
 * A leading index of SingSaver pages that historically carried gift promotions.
 *
 * Listing/campaign pages are server-rendered and embed gift components as
 * `data-gift-uid` attributes plus visible "Nintendo Switch" markup. The T&C PDFs
 * enumerate the full gift catalogue (including top-up upgrades).
 */
export const SOURCES: readonly Source[] = [
  {
    id: "best",
    label: "Best Credit Cards listing",
    url: `${ORIGIN}/credit-card/best`,
    kind: "html",
  },
  {
    id: "high-value-gifts",
    label: "Best High-Value Gifts",
    url: `${ORIGIN}/credit-card/best-deals-high-value-gifts`,
    kind: "html",
    watchOnChange: true,
  },
  {
    id: "dbs-livefresh-altitude-posbeveryday",
    label: "DBS/POSB campaign (Live Fresh, Altitude, Everyday)",
    url: `${ORIGIN}/campaign/dbs-credit-card-livefresh-altitude-posbeveryday`,
    kind: "html",
    watchOnChange: true,
  },
  {
    id: "campaign-index",
    label: "Campaign sitemap",
    url: `${ORIGIN}/sitemap.xml`,
    kind: "html",
    watchOnChange: true,
  },
] as const;

/**
 * Known SingSaver Reward T&C documents. SingSaver publishes these under a
 * hashed blob path; the newest one is mirrored here and updated over time.
 */
export const TERMS_SOURCES: readonly Source[] = [
  {
    id: "rewards-tnc-2026-01",
    label: "SingSaver Rewards Campaign T&C (Jan 2026)",
    url: "https://mhgprod.blob.core.windows.net/singsaver/strapi-uploads/Sing_Saver_Rewards_Campaign_Terms_and_Conditions_21012026_3150ef68c1.pdf",
    kind: "pdf",
    watchOnChange: true,
  },
] as const;

/**
 * Third-party deal trackers that regularly post SingSaver Switch promotions.
 * These are watched for corroboration and earlier detection; hits are labelled
 * with the tracker name so they can be told apart from SingSaver's own pages.
 */
export const TRACKER_SOURCES: readonly Source[] = [
  {
    id: "tracker-milelion",
    label: "The MileLion (deals)",
    url: "https://milelion.com/category/deals/",
    kind: "html",
    watchOnChange: true,
  },
  {
    id: "tracker-sethisfy-june-2026",
    label: "Sethisfy card deals",
    url: "https://sethisfy.com/card-deals-june-2026",
    kind: "html",
    watchOnChange: true,
  },
] as const;

/** Every source the watcher scans by default. */
export const ALL_SOURCES: readonly Source[] = [
  ...SOURCES,
  ...TRACKER_SOURCES,
  ...TERMS_SOURCES,
];

/** Look up a source by id across all source lists. */
export function findSource(id: string): Source | undefined {
  return ALL_SOURCES.find((s) => s.id === id);
}
