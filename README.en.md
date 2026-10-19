# Free Egg Credits

[中文](README.md) | [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-3c873a.svg)](package.json)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4b8bf5.svg)](https://github.com/topics/dsh-plugin)

A plugin for the DSH (DeepSeek Harness) web UI that surfaces the
**available credits**, **daily check-in state** of accounts on your local reverse-proxy gateways
(WorkBuddy / Qoder), and the **credits each conversation** is estimated to have consumed — in the
sidebar, under the composer, at the end of every turn, and in a settings section.

> Credits are **estimates**: WorkBuddy uses its account `model_costs` ledger and Qoder uses the panel
> `/usage` ledger (real `credit ÷ total_tokens`) as measured rates; models without measurements are
> estimated from each gateway's model catalog multipliers. The UI always prefixes values with `≈`.

## Where it shows up

- **Sidebar footer (above the account row)**: a credits block. Each row is
  "status dot · account name · source badge (WB/Qoder) · today's usage · balance". Check-in state is
  expressed only by the leftmost dot (green = checked in today); rate-limit / degrade / failure
  streaks appear as badges with a recovery time. Hidden while the sidebar is collapsed.
  **The highlight is pinned per foreground conversation**: each session gets one serving account
  after its first reply and keeps it (switching conversations only switches the highlighted row —
  it never jumps around with the globally latest request). The active row gets a **gray
  selection-style background**, with no extra row or top banner. Each row also has a small
  "today's usage" pill (down-arrow icon + credits): WorkBuddy from balance deltas, Qoder from its
  usage ledger.
- **Below the composer**: total estimated credits for the current conversation. As long as the
  conversation uses a model from a free-egg provider (by default `free-egg` / `workbuddy` / `qoder` /
  `new-api`), this strip stays visible — `≈0` before the first reply, and a “rate pending” hint when
  the model has no rate yet. It stays hidden for other providers (e.g. the official DeepSeek
  account) so the numbers are not misleading.
- **End of each turn**: estimated credits for that turn (`This turn ≈N credits`; hover for tokens
  and models).
- **Settings → Free Tier Credits**: account cards (name / source / balance / check-in / usage /
  check-in now), rate-limit and degrade details, the measured credit rate, recent chats and
  per-turn breakdown.

WorkBuddy and Qoder accounts share the same row/card layout and are distinguished only by the
source badge.

## Install

The plugin has no runtime dependencies; all you need is a working DSH web GUI.

### Option 1: install from GitHub

```bash
dsh plugin --profile web add github:Yhx888/dsh-free-egg-credits
```

Then add the configuration from the [Configuration](#configuration) section and restart DSH.

> The `desktop` profile managed by the official desktop app rejects CLI installs
> (`managed exclusively by the Electron application`); use the manual link below in that case.

### Option 2: manual link (desktop app / local development)

Install it as a `link:` dependency in the DSH profile — no copy into `node_modules`, and source
changes take effect after restarting DSH:

```jsonc
// ~/.dsh/profiles/<profile>/package.json
"dependencies": {
  "dsh-free-egg-credits": "link:/absolute/path/to/dsh-free-egg-credits"
},
"dsh": { "profile": { "bundles": [ "...", "dsh-free-egg-credits" ] } }
```

```powershell
# A junction does not need administrator rights
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\<profile>\node_modules\dsh-free-egg-credits" `
  -Target "C:\absolute\path\to\dsh-free-egg-credits"
```

Changes to the host half (`index.js`) require a DSH restart; client-half changes only need a page
refresh.

## External dependencies (optional)

| Dependency | Purpose | Config |
|---|---|---|
| [WorkBuddy2API gateway](https://github.com/linguo2625469/workbuddy2api-panel) (`workbuddy2api`) | WorkBuddy / CodeBuddy account credits and check-in | `gatewayBaseUrl`, `gatewayConfigPath` |
| [Qoder gateway](https://github.com/shuishuipingan/qoder2api-hub) (`qoder2api-hub`) | Qoder account credits and check-in scheduler | `qoder.baseUrl`, `qoder.panelPasswordFile` |

Neither gateway is part of this repository; the plugin only reads their HTTP APIs. Gateway keys and
the panel password are read on the host side and are never sent to the browser.

## Configuration

Put this in the target profile's `cordis.patch.yml` (plugin id `free-egg-credits`):

```yaml
- id: free-egg-credits
  config:
    gatewayBaseUrl: 'http://127.0.0.1:7863'
    gatewayConfigPath: 'C:/path/to/workbuddy2api/config.json'
    realms: [cn]
    autoCheckin: true
    checkinAfterHour: 8
    checkinRetryMinutes: 10
    refreshSeconds: 30
    creditsPer1k: {}
    freeEggProviders: [free-egg, workbuddy, qoder, new-api]
    catalogBaseCreditsPer1k: 0
    qoder:
      baseUrl: 'http://127.0.0.1:8790'
      panelPasswordFile: 'C:/path/to/qoder2api/.panel-password'
```

> This layer **replaces** the bundle-level config wholesale (it is not a deep merge). Once you
> write a `qoder` key, include all of its fields (`baseUrl` is required; `panelPasswordFile`,
> `panelPassword` and `enabled` are optional).

| Field | Default | Description |
|---|---|---|
| `gatewayBaseUrl` | `http://127.0.0.1:7863` | WorkBuddy gateway URL |
| `gatewayConfigPath` | `config.json` two levels above the package | Reads `api_key` from the gateway config. The default only works for the dev layout where the plugin sits inside the gateway repo; when installed elsewhere, point this at the gateway `config.json` explicitly — otherwise no key is found, the gateway is reported offline and the sidebar only shows a title with no account rows |
| `apiKey` | empty | Inline key (takes precedence over the config file) |
| `realms` | `[cn]` | Which realms to count; mainland accounts are `cn` |
| `autoCheckin` | `true` | Auto check-in / check-in state probing |
| `checkinAfterHour` | `8` | Do not probe before this hour |
| `checkinRetryMinutes` | `10` | Retry interval after a failure |
| `refreshSeconds` | `30` | Gateway snapshot cache |
| `creditsPer1k` | `{}` | Rate overrides (model name → credits per 1k tokens); highest precedence |
| `freeEggProviders` | `['free-egg','workbuddy','qoder','new-api']` | DSH providers treated as free-egg: their conversations keep the credits strip visible, and only their turns are priced |
| `catalogBaseCreditsPer1k` | `0` | Fallback calibration base for catalog-multiplier estimates (credits per 1k tokens per multiplier unit); `0` = auto-calibrate from measured gateway rates only |
| `qoder` | none | Qoder gateway config: `baseUrl`, `panelPasswordFile`, `panelPassword` (inline fallback), `enabled`. Omit to disable the Qoder source |

## Data sources

| Data | Source |
|---|---|
| WorkBuddy credits | Gateway panel `GET /panel/api/overview` (accounts with `realm=cn`) |
| WorkBuddy check-in | Once per day, on first UI open, a single-account check-in call (`POST /panel/api/accounts/{uid}/checkin`). Upstream returns `10001 already checked in` for repeats — idempotent, no side effects; if not checked in yet, it completes today's check-in |
| Qoder credits | Qoder gateway `GET /credits/summary` (registered view: `credits_remain` / `credits_size`) |
| Qoder check-in | Qoder gateway `GET /scheduler`: if the scheduler ran a check-in pass today, it counts as checked in; `next_run_time` is the next pass |
| Session serving account | WorkBuddy panel `token_usage.last_used_at` / `last_model`; Qoder panel `GET /usage/recent` (`account` / `model` / `at`, cached for 3 s). After each reply the host waits 1.5 s, refreshes both gateways and matches the latest request to that session by timestamp; the first match is pinned and never switches |
| Today's usage per account | WorkBuddy: sum of balance decreases between snapshots (the gateway deducts the upstream `credit` from account balance); the ledger is persisted to `<DSH_HOME>/free-egg-credits/daily.json` and continues across DSH restarts. Qoder: exact sum of `credit` over today's `/usage/recent` rows |
| Tokens per turn | `assistant/message.usage` in DSH session events (folded on the host, never persisted) |
| Credit rate (WorkBuddy measured) | `model_costs[].cost_per_1k` from gateway account state, weighted by sample count |
| Credit rate (Qoder measured) | Qoder panel `GET /usage` `by_model` ledger: real `credit ÷ total_tokens` (includes cache-hit discounts); cached for 5 minutes |
| Credit rate (estimated) | Model catalog multipliers: WorkBuddy `GET /v1/models` `credits` (e.g. `x0.11`), Qoder `GET /models` `price_factor`; each gateway is calibrated against its own measured rates; a multiplier of `0` means a free model (0 credits) |
| free-egg aggregation aliases | When e.g. `deepseek-v4.1-flash` is actually served by Qoder `DeepSeek-Flash`, a version-insensitive normalized match against measured rates is used; override with `creditsPer1k` when ambiguous |
| Model source | `assistant/message.message.source.provider` / `model` in DSH session events, plus the current provider / model from `model/selection` and `request/header` events (used to decide whether a conversation counts as free-egg) |
| Rate limits | `rate_limited_models[]` (model / until / reset_at) and `degrade_until` from gateway account state; expired entries disappear automatically. The **reset time** uses upstream `reset_at` (when the model truly becomes available again, falling back to `until`), shown as `Limited HH:mm` in the sidebar (latest across models); the settings page lists `until` separately as "local cooldown until" |

## How it works

The plugin has a host half and a client half:

- **Host half (`index.js`)**: `inject: ['webServer']`; registers five endpoints under the
  same-origin `/__dsh-wb-credits` prefix (`GET /snapshot`, `GET /sessions`, `POST /refresh`,
  `POST /checkin`, `POST /qoder/checkin`). It reads gateway panels and model catalogs, decides
  check-in state, folds per-turn token usage from `session/event` plus the session log, tracks which
  provider each turn came from, and converts tokens to credits through three layers (measured rate →
  catalog-multiplier estimate → config override). After each reply it refreshes WorkBuddy
  `token_usage` and Qoder `/usage/recent`, attributes that request to the session by timestamp and
  pins the first match (a session never switches accounts), and maintains per-account "today's
  usage" (WorkBuddy balance deltas persisted across restarts; Qoder exact ledger sums) for the
  sidebar. Keys, password and panel token only ever exist in this process.
- **Client half (`client.js`)**: a hand-written `window.__ModuleLoader__` bundle that injects React
  components into `sidebar.footer.action`, `conversation.composer.dock`,
  `conversation.chat.turnTail` and `settings.section`. It only reads the same-origin endpoints
  above and reuses host CSS variables (`--dsw-alias-*`).

Check-in is probe-based: on the first UI open of the day, accounts that are not known to be checked
in get one idempotent check-in call and its response decides the state. Set `autoCheckin: false` to
disable automatic check-in; state may then show as unknown and you can check in manually from the
settings page.

## Privacy and security

- **No telemetry**: the plugin only talks to the local gateway URLs in its config.
- **Credentials stay on the host**: the WorkBuddy `api_key` is read from the gateway `config.json`
  and the Qoder panel password from its password file; neither appears in snapshots sent to the
  browser.
- **No arbitrary proxying**: the check-in endpoint only accepts account uids that are already in
  the snapshot.
- Plugin routes rely on DSH's own authentication; **do not expose the DSH port to the public
  internet without an auth layer**.

Please report security issues privately as described in [SECURITY.md](SECURITY.md).

## Known limitations

- Credits are estimates: actual charges during upstream free periods can be lower, hence the `≈`.
- The serving-account attribution comes from the gateway's **write-back after a request completes**: it does not change during streaming and updates once the turn finishes (usually within seconds). It is pinned per session, so two concurrent conversations keep their own accounts; if the very first match is wrong (two requests completing too close together), that session keeps the first result — the trade-off for never flip-flopping.
- WorkBuddy's "today's usage" needs a balance baseline: the new host starts accumulating from the first balance it sees for that account, so on the very first day it may only count from when the host started (the gateway has no per-day credit API); once persisted, DSH restarts continue the ledger. Qoder's today usage is recomputed exactly from its usage ledger since local midnight.
- Only conversations from free-egg providers (by default `free-egg` / `workbuddy` / `qoder` /
  `new-api`) are priced; other providers (e.g. the official DeepSeek account) only show tokens and
  `—` for credits, and the composer strip stays hidden.
- Rates for models without measurements are **estimated from catalog multipliers**: each gateway's
  baseline is calibrated from models measured on this machine, so switching models or upstream price
  changes can introduce drift. Use `creditsPer1k` for exact overrides.
- Qoder measured rates include cache-hit discounts (observed as high as 98% cached input), so they
  are a recent average for that model and drift when the cache mix changes.
- free-egg aggregation aliases are matched by stripping version numbers (DeepSeek-Flash /
  deepseek-v4.1-flash); if a match is ambiguous, set `creditsPer1k` explicitly.
- Check-in state depends on one idempotent check-in call; with `autoCheckin` disabled it can be
  "unknown".
- Qoder credits use the upstream registered view (`credits_remain` / `credits_size`) and are
  written back by the gateway after check-in or usage. Snapshots are cached for 60 seconds; the
  settings page refresh forces a new pull.
- Built against the current DSH `slots` / `webServer` / `session/event` mechanisms; major DSH
  changes may require follow-up work.

## Development

```bash
npm run check   # node --check index.js && node --check client.js
```

- No runtime dependencies; no `npm install` needed.
- Host-half changes require a DSH restart; client-half changes only a page refresh.
- When adding UI strings, update both the `ZH` and `EN` tables in `client.js`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for details and [CHANGELOG.md](CHANGELOG.md) for release
history.

## License

[MIT](LICENSE) © 2026 dsh-free-egg-credits contributors

## Disclaimer

This project is not affiliated with WorkBuddy, Qoder or DeepSeek, and it does not include any
upstream service or reverse-proxy gateway implementation. It is only a presentation layer that
reads the public HTTP APIs of gateways running on your own machine. Using third-party gateways may
be subject to their own terms; you are responsible for complying with them.
