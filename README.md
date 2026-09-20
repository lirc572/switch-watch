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
- CLI/API failures, quota errors and malformed model replies are recorded as
  `valid: null, error: true`, not as expired offers. Raw alerts still go through.
- If GitHub issue creation fails, the workflow fails **before committing state**,
  so the next scheduled run can retry delivery rather than lose the alert.

## Alerts

On every run inside GitHub Actions the watcher:

1. writes a Markdown report to the **job summary**,
2. emits `::warning::` **annotations** for each new Switch hit,
3. (optionally) asks an LLM whether each finding is *currently valid*,
4. opens (or comments on) an issue labelled **`switch-offer`**.

State (`data/state.json`) is committed back so hits are only reported once.

### Copilot analysis (default in Actions)

The workflow now defaults to **GitHub Copilot CLI**, using the built-in
`GITHUB_TOKEN` with `copilot-requests: write`. It installs the tested CLI version
`1.0.86` on Node.js 22 only when there are **new Switch hits**. Routine page-hash
changes and already-reported gifts do not use model calls.

For a **personally-owned repository**, GitHub bills this usage to the repository
owner's Copilot seat. If that owner has **Copilot Pro**, no separate OpenAI API
key or PAT is needed. This is **not unlimited free inference**: Copilot model
access, credits/usage limits and billing rules still apply. Monitor your Copilot
usage and configure the account's budget as appropriate.

For an **organization-owned repository**, `GITHUB_TOKEN` usage is billed to the
organization, not automatically to a member's personal Pro subscription. An
organization owner must enable **Allow use of Copilot CLI billed to the
organization**. If you explicitly want to authenticate as an individual instead,
create a fine-grained PAT with the **Copilot Requests** user permission and store
it as the optional `COPILOT_GITHUB_TOKEN` repository secret. Do not paste it into
code or logs.

[Official authentication and billing documentation](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/copilot-cli-in-github-actions)
· [Actions setup](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-in-actions)

Optional **repository variables** (Settings → Secrets and variables → Actions → Variables):

| name | default | purpose |
| --- | --- | --- |
| `LLM_BACKEND` | `copilot` in Actions | `copilot`, `openai`, or `off` |
| `COPILOT_MODEL` | `auto` | Model available to the authenticated Copilot seat |
| `COPILOT_MAX_AI_CREDITS` | `30` | Soft spending limit per source analysis |

The credit cap is **soft**: an in-progress response can exceed it. It is not a
replacement for account billing controls. Each CLI invocation also has a
120-second timeout, with no automatic paid-provider fallback.
[Copilot credit-limit documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/set-session-limit)

#### What the model does

The model receives bounded snippets, dates, promo codes and expiry phrases —
not the full repository. It returns a structured verdict:

- `valid: true`: evidence suggests the Switch promotion is currently active;
- `valid: false`: concrete evidence indicates expiry or an irrelevant offer;
- `valid: null`: insufficient/conflicting evidence, or an analysis error.

Explicitly stale findings are collapsed in the issue; if all new findings are
stale, no issue is opened. Uncertain/failed analyses remain **unverified** alerts.
HTTP 200, a call-to-action or a copyright year alone do not establish validity.
Always verify the actual promotion terms before applying; the model can be wrong.

**Safety:** the CLI runs outside the checkout in a fresh temporary working and
configuration directory, with tools, MCP, custom instructions and remote
sessions disabled. Prompts are passed as a single process argument (no shell),
and unrelated environment secrets are not forwarded. Temporary data is removed
after each call. These restrictions are not an OS-level sandbox.

#### Keep using an OpenAI-compatible endpoint

Set repository variable `LLM_BACKEND=openai`, then configure:

| kind | name | example |
| --- | --- | --- |
| secret | `LLM_API_KEY` | Your provider's API key |
| variable | `LLM_BASE_URL` | `https://api.openai.com/v1` (default) |
| variable | `LLM_MODEL` | `gpt-4o-mini` (default) |

The endpoint must support chat completions and JSON-object output. With missing
credentials or `LLM_BACKEND=off`, analysis is skipped and raw alerts are retained.
Locally the default remains `openai` for backwards compatibility; use
`LLM_BACKEND=copilot` explicitly for Copilot CLI (installed separately, with a
Copilot-enabled token in the environment).

The current `data/state.json` is **not reset** by this upgrade. Previously reported
offers will not be re-analyzed just because the backend changed. To exercise the
CLI with a saved report containing new hits, without touching state or opening
issues:

```bash
LLM_BACKEND=copilot bun run src/analyze.ts report.json \
  --out analyzed-report.json --summary llm-summary.md
```

Automated tests use injected responses and a fake CLI executable: they do not
call a paid model or prove that a promotion is valid.

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
