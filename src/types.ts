/**
 * Public types for switch-watch.
 */

/** A page or document that is scanned for Nintendo Switch promotions. */
export interface Source {
  /** Stable id used in the state file. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Absolute URL to fetch. */
  url: string;
  /**
   * "html" for rendered pages, "pdf" for documents. PDFs are decoded with
   * `pdftotext` when available; otherwise the raw bytes are searched as latin1.
   */
  kind: "html" | "pdf";
  /** When true, a change alone (no Switch match) is worth reporting. */
  watchOnChange?: boolean;
}

/** A single Nintendo Switch mention found on a source. */
export interface SwitchHit {
  /** Source id where the hit was found. */
  sourceId: string;
  /** Source label. */
  sourceLabel: string;
  /** Absolute source URL. */
  url: string;
  /** The matched token, e.g. "Nintendo Switch 2". */
  match: string;
  /** Context window around the match. */
  context: string;
  /**
   * Best-effort gift identifier parsed from the context, e.g.
   * "TOPUP.NINTENDO.SWITCH-2.719" or "Nintendo Switch OLED".
   */
  gift?: string;
  /** Whether the offer looks like a free gift or a paid top-up. */
  kind?: "free" | "topup" | "unknown";
  /** Price parsed from context, in SGD, when present. */
  price?: number;
}

/** Per-source scan result. */
export interface SourceResult {
  source: Source;
  /** HTTP status code, or 0 when the request itself failed. */
  status: number;
  /** Content hash (sha256 hex) of the normalised body. */
  hash: string;
  /** Switch hits found on this run. */
  hits: SwitchHit[];
  /** Error message when the fetch failed. */
  error?: string;
}

/** Persisted detector state, committed back to the repository. */
export interface WatchState {
  /** Schema version for forward compatibility. */
  version: 1;
  /** ISO timestamp of the last successful run. */
  updatedAt: string;
  /** Map of source id -> last seen content hash. */
  hashes: Record<string, string>;
  /** Stable keys (sourceId + match) of Switch hits already reported. */
  reported: string[];
}

/** A change detected relative to the previous state. */
export interface Change {
  sourceId: string;
  sourceLabel: string;
  url: string;
  /** "new-hits" when Switch hits appear, "changed" when only the body changed. */
  type: "new-hits" | "changed";
  hits: SwitchHit[];
}

/** Options for {@link runWatch}. */
export interface RunOptions {
  /** HTTP timeout per request in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** Custom fetch implementation (useful for testing). */
  fetch?: typeof fetch;
  /** Concurrency for source fetching. Defaults to 4. */
  concurrency?: number;
  /** Fetch attempts per source on transient failure. Defaults to 2. */
  retries?: number;
}
