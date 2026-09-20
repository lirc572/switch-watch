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

## Alerts

On every run inside GitHub Actions the watcher:

1. writes a Markdown report to the **job summary**,
2. emits `::warning::` **annotations** for each new Switch hit,
3. opens (or comments on) an issue labelled **`switch-offer`**.

State (`data/state.json`) is committed back so hits are only reported once.

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
--json               emit JSON instead of text
--no-terms           skip the PDF T&C sources
--fail-on-hit        exit code 2 when new hits are found
--concurrency <n>    parallel fetches (default 4)
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
