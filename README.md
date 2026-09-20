# switch-watch 🎮

Watches SingSaver (and a few deal trackers) for **credit-card promotions that
give away a Nintendo Switch**, and pings you from GitHub Actions when a new one
shows up.

> Unofficial. Not affiliated with SingSaver / MoneyHero, Nintendo, or the banks.

## Why

SingSaver replenishes its welcome gifts constantly — Nintendo Switch, Switch
OLED, Switch 2 have all appeared over the years, usually as either a *free* gift
choice or a paid *top-up* upgrade. These promos are time-limited and buried in
campaign pages / T&C PDFs, so this repo polls them on a cron and alerts on
change.

## What it monitors

| source | what it is |
| --- | --- |
| `best` | SingSaver "Best Credit Cards" listing |
| `high-value-gifts` | SingSaver high-value gift deals page |
| `dbs-livefresh-altitude-posbeveryday` | DBS/POSB campaign page (historic Switch source) |
| `campaign-index` | SingSaver sitemap (catches new campaign pages) |
| `tracker-milelion` | The MileLion deals category |
| `tracker-sethisfy-june-2026` | Sethisfy card-deals page |
| `rewards-tnc-2026-01` | SingSaver Rewards T&C PDF (full gift catalogue) |

Each source is fetched, normalised and SHA-256 hashed. The body is also scanned
for `Nintendo Switch` mentions (including `Switch 2` / `Switch OLED`), gift uids
such as `TOPUP.NINTENDO.SWITCH-2.719`, prices, and whether the offer is a free
gift or a top-up.

A change is reported when:

- a source contains a Switch hit that has **not been reported before**, or
- a source marked `watchOnChange` has a body hash that moved.

### Robustness

- Transient failures are retried (`--retries`, default 2).
- Anti-bot interstitial pages (Cloudflare etc.) return a 2xx but are treated as
  *soft failures*: they keep the previous hash so the next good run does not
  fire a spurious `changed` alert.
- Noise is filtered: image asset URLs, `alt`/`srcset` fragments, and
  User-Agent console-detection regexes are ignored.
- Annotations go to **stderr**, so `--json` stdout is always valid JSON.
- The optional LLM step never fails the workflow; a model error is recorded as
  `valid: false, error: true` and the raw findings still go through.

## Alerts

On every run inside GitHub Actions the watcher:

1. writes a Markdown report to the **job summary**,
2. emits `::warning::` **annotations** for each new Switch hit,
3. (optionally) asks an LLM whether each finding is *currently valid*,
4. opens (or comments on) an issue labelled **`switch-offer`**.

State (`data/state.json`) is committed back so hits are only reported once.

### Optional LLM analysis

Rule-based detection can't tell a live promo from a page that merely still
shows an old gift table (e.g. the DBS 2024 Switch OLED campaign page still
returns HTTP 200). The `analyze` step sends the dates, promo codes and expiry
phrases extracted from each page to an OpenAI-compatible chat model, which
returns a structured verdict (`valid`, `reason`, `promoPeriod`, `cards`,
`conditions`, `confidence`). Findings judged stale are collapsed in the issue,
and an issue is only opened if at least one finding looks live.

Enable it with repository settings:

| kind | name | example |
| --- | --- | --- |
| secret | `LLM_API_KEY` | `sk-...` |
| variable | `LLM_BASE_URL` | `https://api.openai.com/v1` (default) |
| variable | `LLM_MODEL` | `gpt-4o-mini` (default) |

Any OpenAI-compatible endpoint works (OpenAI, DeepSeek, Groq, OpenRouter,
Ollama, …). **Without `LLM_API_KEY` the step no-ops** and everything behaves as
before.

## Run locally

```bash
bun install
bun run watch            # human-readable scan
bun run watch --json     # machine-readable report
bun test                 # unit tests (mocked fetch)
bun run typecheck
```

PDF sources need `pdftotext` from poppler (`brew install poppler`,
`apt-get install poppler-utils`). Without it, PDFs fall back to a raw byte scan
(and may report no hits).

Useful flags:

```
--state <path>       state file (default data/state.json)
--out <path>         where to write the next state
--summary <path>     write a Markdown summary here
--report <path>      write the JSON report here (stdout stays clean)
--json               emit JSON to stdout
--no-terms           skip the PDF T&C sources
--fail-on-hit        exit code 2 when new hits are found
--concurrency <n>    parallel fetches (default 4)
--retries <n>        fetch attempts per source (default 2)
--timeout <ms>       per-request timeout (default 30000)
```

## Schedule

`.github/workflows/switch-watch.yml` runs at **01:17 and 13:17 UTC**
(09:17 / 21:17 SGT) every day, plus manual `workflow_dispatch`.

## Library

```ts
import { ALL_SOURCES, scanAll, diff, parseState } from "switch-watch";

const results = await scanAll(ALL_SOURCES);
const { changes } = diff(results, parseState(null));
console.log(changes);
```

## Adding a source

Append to `SOURCES` / `TRACKER_SOURCES` / `TERMS_SOURCES` in `src/sources.ts`.
Set `watchOnChange: true` if the page is worth reporting even without an
explicit Switch keyword (e.g. sitemaps and campaign pages).

## License

MIT
