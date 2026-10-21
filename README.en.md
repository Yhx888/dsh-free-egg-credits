<p align="center"><img src="icon.svg" width="72" height="72" alt="Free Egg Credits icon"></p>

# Free Egg Credits

[中文](README.md) | [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-3c873a.svg)](package.json)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4b8bf5.svg)](https://github.com/topics/dsh-plugin)
[![DSH Marketplace](https://img.shields.io/badge/DSH-Marketplace-2f6feb.svg)](https://github.com/bradeGithub/DSH-Plugins-Marketplace)

A plugin for the DSH (DeepSeek Harness) web UI that surfaces the
**available credits**, **daily credit budget (used / limit / remaining / capped)** and
**daily check-in state** of accounts on your local reverse-proxy gateways (WorkBuddy / Qoder),
plus the **credits each conversation** is estimated to have consumed — in the sidebar, under the
composer, at the end of every turn, and in a settings section. The settings page can also switch
**which platform's credits are spent first** (via local new-api channel priorities, so you can
fall back to WorkBuddy when Qoder is congested).

> Credits are **estimates**: WorkBuddy uses its account `model_costs` ledger and Qoder uses the panel
> `/usage` ledger (real `credit ÷ total_tokens`) as measured rates; models without measurements are
> estimated from each gateway's model catalog multipliers. The UI always prefixes values with `≈`.

## Quick start

> **Stop juggling three dashboards**: see WorkBuddy / Qoder credits, today's budget, check-in state and per-turn spend in the DSH sidebar — and switch which platform is spent first with one click when new-api is configured.

### One-click install

```bash
dsh plugin --profile web add github:Yhx888/dsh-free-egg-credits
```

- **Desktop app**: open **Plugins → Add plugin**, paste `https://github.com/Yhx888/dsh-free-egg-credits`, install, then restart DSH.
- **Web / CLI**: run the command above, fill in the gateway addresses and secret-file paths from [Configuration](#configuration), then restart DSH.
- **Already running WorkBuddy2API / qoder2api-hub?** Usually you only need `gatewayBaseUrl` + `gatewayConfigPath` (WorkBuddy) and `qoder.baseUrl` + `qoder.panelPasswordFile` (Qoder); `newApi` is optional.

> **Who it's for**: users already running WorkBuddy2API / qoder2api-hub (optionally new-api) locally. The plugin only reads those local gateway APIs; it does not provide accounts, credits or gateways, and shows nothing without them.

### What it solves

- **No more panel hopping**: balance, today's used / limit, check-in state and the active account — all in the sidebar.
- **Know where credits go**: per-conversation and per-turn estimates, with tokens and models on hover.
- **A way out when capped**: when Qoder is congested or out of budget, one click switches to WorkBuddy-first (requires `newApi`).

> Listed in the community [DSH Plugin Marketplace](https://github.com/bradeGithub/DSH-Plugins-Marketplace) (index refreshed every 2 hours); search for `Free Egg`, `dsh-free-egg-credits`, `WorkBuddy` or `Qoder`.

## Where it shows up

- **Sidebar footer (above the account row)**: a credits block. Each row is
  "status dot · account name · source badge (WB/Qoder) · today's usage · balance". Check-in state is
  expressed only by the leftmost dot (green = checked in today; yellow = not checked in yet / today's
  reward pending); rate-limit / degrade / failure streaks appear as badges with a recovery time.
  Hidden while the sidebar is collapsed.
  **The highlight is pinned per foreground conversation**: each session gets one serving account
  after its first reply and keeps it (switching conversations only switches the highlighted row —
  it never jumps around with the globally latest request). The active row gets a **gray
  selection-style background**, with no extra row or top banner. Each row also has a small
  "today's usage" pill (down-arrow icon + credits): WorkBuddy from balance deltas, Qoder from its
  usage ledger. Once the gateway enables the daily credit budget it becomes "used / limit"
  (e.g. `118/100`); a capped account is drawn in the host warning color (hover: "Daily limit
  reached — account paused, resets at 00:00"), and when every account is capped the block gets one
  extra "daily credits used up" line. The block header also has a compact **credit-priority chip**
  (e.g. `WB first`): one click switches to the other platform without opening settings.
- **Below the composer**: total estimated credits for the current conversation. As long as the
  conversation uses a model from a free-egg provider (by default `free-egg` / `workbuddy` / `qoder` /
  `new-api`), this strip stays visible — `≈0` before the first reply, and a “rate pending” hint when
  the model has no rate yet. It stays hidden for other providers (e.g. the official DeepSeek
  account) so the numbers are not misleading.
- **End of each turn**: estimated credits for that turn (`This turn ≈N credits`; hover for tokens
  and models).
- **Settings → Free Tier Credits**: account cards (name / source / balance / check-in / usage /
  daily used ≈X of limit (≈Y left) / check-in now), **credit priority** (WorkBuddy-first / Qoder-first
  toggle), rate-limit and degrade details, the measured credit rate, recent chats and per-turn
  breakdown. When every account is capped, a notice line is added at the top of the page.

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
| [New API](https://github.com/QuantumNous/new-api) (`new-api`, `:3001`) | Credit priority switching (channel priorities) | `newApi.*` |

Neither gateway is part of this repository; the plugin only reads their HTTP APIs. Gateway keys, the
panel password and the new-api admin token are read on the host side and are never sent to the browser.

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
    # Optional: credit-priority switching (changes two local new-api channel priorities).
    # When omitted the whole control is hidden and nothing else changes.
    newApi:
      baseUrl: 'http://127.0.0.1:3001'
      userId: 1
      accessTokenFile: 'C:/path/to/new-api-access-token'   # file content = admin access token
      # accessToken: '<inline fallback, either one>'
      channels:
        workbuddy: 13
        qoder: 12
      priorities:
        preferred: 10
        fallback: 5
```

> This layer **replaces** the bundle-level config wholesale (it is not a deep merge). Once you
> write a `qoder` key, include all of its fields (`baseUrl` is required; `panelPasswordFile`,
> `panelPassword` and `enabled` are optional). The same applies to `newApi` (`baseUrl` required).

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
| `newApi` | none | new-api admin config for credit-priority switching: `baseUrl`, `userId`, `accessToken` / `accessTokenFile`, `channels.workbuddy` / `channels.qoder`, `priorities.preferred` / `priorities.fallback`. Omit to hide the feature |

## Daily credit budget (enforced by the gateways)

The daily budget and account selection are enforced **by the gateways**; this plugin only reads
the fields and displays them (it never throttles or switches accounts). Reference setup on this
machine:

- **WorkBuddy** (`workbuddy2api` `config.json` → `pool`): `daily_credit_limit = 100` (`0` disables
  it) plus `prefer_credits = true` (healthy candidates are preferred by highest balance).
- **Qoder** (`qoder2api-hub` panel → "daily credit limit"): per-realm `daily_credit_limit = 100`
  (`cn`).

Once enabled:

- When an account's usage reaches the limit (WorkBuddy `daily_credit_spent >= daily_credit_limit`;
  Qoder `creditLimitReached = true`), the gateway stops routing new requests to it (sticky-session
  paths reject it and let the caller re-select);
- Within one gateway the **highest-balance** account is used first, until it hits its limit and is
  skipped;
- After all four accounts (2 WorkBuddy + 2 Qoder) are capped, new-api's `qwen-fallback` channel
  automatically downgrades DeepSeek requests to Qwen3.8-Flash (free); traffic returns to DeepSeek
  as soon as WorkBuddy/Qoder has budget again.

What the plugin shows:

- The sidebar pill becomes "used / limit" (e.g. `118/100`) when a budget is enabled; a capped
  account uses the host warning color and its tooltip spells out "Daily limit reached — account
  paused, resets at 00:00". Without a budget it keeps the old `≈N credits` style.
- The settings card shows "≈X of 100 credits used today (≈Y left)" plus a cap notice line.
- When **all** accounts in one snapshot (WorkBuddy + Qoder combined, at least one) are capped, both
  the top of the settings page and the sidebar block add one line:
  "Daily credits used up: DeepSeek falls back to Qwen3.8-Flash (free) automatically".

> Old gateways without the daily-budget fields, or a failed Qoder `/accounts` read, make the plugin
> fall back to the previous "today's usage" rendering (Qoder keeps the last successfully fetched
> budget values); the refresh itself still succeeds.

## Credit priority (platform level)

DeepSeek requests are routed by your local new-api (default `http://127.0.0.1:3001`) between the
WorkBuddy and Qoder channels. The plugin turns this into a switch: two mutually exclusive buttons in
the settings page ("Prefer WorkBuddy" / "Prefer Qoder"), plus a compact chip in the sidebar block
header. One click rewrites the two new-api channel priorities (WorkBuddy channel id 13 and Qoder
channel id 12 on this machine):

| Choice | WorkBuddy channel | Qoder channel | Effect |
|---|---|---|---|
| Prefer WorkBuddy (existing default) | `10` | `5` | DeepSeek burns WorkBuddy credits first; Qoder only on failure / cap |
| Prefer Qoder | `5` | `10` | DeepSeek burns Qoder credits first; falls back to WorkBuddy on congestion / failure / cap |

- The change is **effective immediately** (new-api rebuilds its channel cache) and only affects new
  requests; in-flight conversations are untouched.
- Only **channel priorities** change; the gateways still pick accounts inside their own pools by
  balance / daily budget.
- The choice is persisted in `<DSH_HOME>/free-egg-credits/routing.json`; the effective state is read
  back from new-api every 30 s (the settings refresh forces a re-read). If the priorities were changed
  elsewhere the settings page says "selected ≠ effective".
- It needs a new-api admin credential (an admin user's access token); the plugin reads it from the
  config / token file on the host and never sends it to the browser. Without `newApi` the whole
  control is hidden and nothing else changes.

Getting the access token: sign in to the new-api console → personal settings → system access token
(regenerating rotates it and invalidates the old value; locally `GET /api/user/token` triggers and
returns the new one). Put it in the file referenced by `accessTokenFile` (recommended; restrict file
permissions) or inline in `accessToken`; **never commit it**.

## Data sources

| Data | Source |
|---|---|
| WorkBuddy credits | Gateway panel `GET /panel/api/overview` (accounts with `realm=cn`) |
| WorkBuddy check-in | Once per day, on first UI open, a single-account check-in call (`POST /panel/api/accounts/{uid}/checkin`). Upstream returns `10001 already checked in` for repeats — idempotent, no side effects; if not checked in yet, it completes today's check-in |
| Qoder credits | Qoder gateway `GET /credits/summary` (registered view: `credits_remain` / `credits_size`) |
| Qoder check-in | Qoder panel `GET /accounts` per-account `lastCheckin` (checked in today / not yet / today's reward pending, with the time); falls back to `GET /scheduler` `last_run_time` when the panel read fails or the account row is missing. Check-in itself is performed by the gateway scheduler in the background |
| Platform credit priority | new-api admin API `GET /api/channel/{id}` (read `priority`) and `PUT /api/channel/` (write `priority`): WorkBuddy channel 13 / Qoder channel 12; verified by reading back after each switch |
| Session serving account | WorkBuddy panel `token_usage.last_used_at` / `last_model`; Qoder panel `GET /usage/recent` (`account` / `model` / `at`, cached for 3 s). After each reply the host waits 1.5 s, refreshes both gateways and matches the latest request to that session by timestamp; the first match is pinned and never switches |
| Today's usage per account | WorkBuddy: sum of balance decreases between snapshots (the gateway deducts the upstream `credit` from account balance); the ledger is persisted to `<DSH_HOME>/free-egg-credits/daily.json` and continues across DSH restarts. Qoder: sum of `credit` over today's `/usage/recent` rows where `billable !== false` (`billable=false` free rows are excluded; older gateways without the field count as billed) |
| Daily credit budget / used today | WorkBuddy: `daily_credit_spent` / `daily_credit_limit` / `daily_credit_capped` on `GET /panel/api/overview` account rows; Qoder: `dailyCreditsToday` / `dailyCreditLimit` / `creditLimitReached` from `GET /accounts` (panel token handled on the host), fetched in the same refresh as `/credits/summary` (60 s cache kept). Qoder's `dailyCreditsToday` is a nominal figure (free calls still accrue `credit`), so the UI uses the local ledger filtered by `billable` instead. Missing fields (old gateways) stay undefined/0/false and the UI falls back to the old "today's usage" rendering; a failed `/accounts` read only leaves the budget fields absent and never fails the Qoder credits refresh |
| Tokens per turn | `assistant/message.usage` in DSH session events (folded on the host, never persisted) |
| Credit rate (WorkBuddy measured) | `model_costs[].cost_per_1k` from gateway account state, weighted by sample count |
| Credit rate (Qoder measured) | Qoder panel `GET /usage` `by_model` ledger: real `credit ÷ total_tokens` (includes cache-hit discounts); cached for 5 minutes |
| Credit rate (estimated) | Model catalog multipliers: WorkBuddy `GET /v1/models` `credits` (e.g. `x0.11`), Qoder `GET /models` `price_factor`; each gateway is calibrated against its own measured rates; a multiplier of `0` means a free model (0 credits) |
| free-egg aggregation aliases | When e.g. `deepseek-v4.1-flash` is actually served by Qoder `DeepSeek-Flash`, a version-insensitive normalized match against measured rates is used; override with `creditsPer1k` when ambiguous |
| Model source | `assistant/message.message.source.provider` / `model` in DSH session events, plus the current provider / model from `model/selection` and `request/header` events (used to decide whether a conversation counts as free-egg) |
| Rate limits | `rate_limited_models[]` (model / until / reset_at) and `degrade_until` from gateway account state; expired entries disappear automatically. The **reset time** uses upstream `reset_at` (when the model truly becomes available again, falling back to `until`), shown as `Limited HH:mm` in the sidebar (latest across models); the settings page lists `until` separately as "local cooldown until" |

## How it works

The plugin has a host half and a client half:

- **Host half (`index.js`)**: `inject: ['webServer']`; registers six endpoints under the
  same-origin `/__dsh-wb-credits` prefix (`GET /snapshot`, `GET /sessions`, `POST /refresh`,
  `POST /checkin`, `POST /qoder/checkin`, `POST /preference`). It reads gateway panels and model
  catalogs, decides check-in state, folds per-turn token usage from `session/event` plus the session
  log, tracks which provider each turn came from, and converts tokens to credits through three
  layers (measured rate → catalog-multiplier estimate → config override). After each reply it
  refreshes WorkBuddy `token_usage` and Qoder `/usage/recent`, attributes that request to the session
  by timestamp and pins the first match (a session never switches accounts), and maintains
  per-account "today's usage" (WorkBuddy balance deltas persisted across restarts; Qoder exact
  ledger sums) for the sidebar. It also maps the gateway-side daily budget fields (WorkBuddy
  `/panel/api/overview`; Qoder `/accounts`, best-effort with last-known values retained on failure).
  The credit-priority switch reads/writes channel priorities through the new-api admin API (the token
  stays on the host); the choice is persisted and the effective state is read back on every snapshot.
  Keys, password, panel token and the new-api token only ever exist in this process.
- **Client half (`client.js`)**: a hand-written `window.__ModuleLoader__` bundle that injects React
  components into `sidebar.footer.action`, `conversation.composer.dock`,
  `conversation.chat.turnTail` and `settings.section`. It only reads the same-origin endpoints
  above and reuses host CSS variables (`--dsw-alias-*`).

Check-in is two-layered — background scheduler plus plugin fallback:

- **Both gateways run their own background schedulers, independent of DSH being open**: WorkBuddy
  checks in per `schedule.checkin_hours` (default `09:00` / `21:00`); the Qoder scheduler checks in
  and claims campaign credits at `09:00` / `10:15` / `10:45` / `21:00` (`next_run_time` is visible in
  the snapshot; the 10:15 and 10:45 slots are retries for delayed upstream campaign publication
  after the 10:00 refresh).
- The plugin's `autoCheckin` only performs an **idempotent backfill / state probe when the UI is
  opened**: WorkBuddy accounts not known to be checked in get one single-account check-in call
  (upstream answers `10001` for "already checked in today", no side effects); Qoder is never
  auto-triggered — its panel `lastCheckin` is displayed and the settings page has a manual button.
- For Qoder, "check-in" means claiming the daily campaign (a new round opens at `10:00` UTC+8). If
  `lastCheckin` is before 10:00 today while the clock is already past 10:00, the dot turns **yellow
  ("today's reward pending")** instead of green — the 09:00 scheduler pass may only have stamped
  yesterday's batch, and today's 100 credits arrive at 21:00 (or via the manual button).
- Set `autoCheckin: false` to disable the plugin probe; WorkBuddy state may then show as unknown and
  you can check in manually from the settings page.
- "Checked in" ≠ "today's credits already credited": balances are whatever the gateway wrote back.
  Qoder's daily campaign refreshes at `10:00` (UTC+8); if the scheduler ran earlier it may stamp the
  account as checked in while today's 100 credits are still to be claimed.

## Privacy and security

- **No telemetry**: the plugin only talks to the local gateway and new-api URLs in its config.
- **Credentials stay on the host**: the WorkBuddy `api_key` is read from the gateway `config.json`,
  the Qoder panel password from its password file, and the new-api admin access token from the
  plugin config / token file; none of them appears in snapshots sent to the browser.
- **No arbitrary proxying**: the check-in endpoint only accepts account uids that are already in
  the snapshot; the priority endpoint only accepts `workbuddy` / `qoder` and only touches the two
  configured channel ids.
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
- Check-in state comes from the gateways: WorkBuddy from one idempotent check-in call, Qoder from the
  panel `lastCheckin`. "Checked in" does not guarantee that today's reward credits have landed yet
  (see "Checked in ≠ today's credits already credited"); with `autoCheckin: false` WorkBuddy state
  can be "unknown".
- Qoder credits use the upstream registered view (`credits_remain` / `credits_size`) and are
  written back by the gateway after check-in or usage. Snapshots are cached for 60 seconds; the
  settings page refresh forces a new pull.
- The credit-priority switch needs a new-api admin access token. When the token expires/rotates the
  switch fails and the settings page shows the error (update `accessTokenFile`; the host re-reads it
  on mtime change). If your new-api channels are not the default 13/12, set `channels` accordingly.
  If another process changes the priorities, the UI reports "selected ≠ effective" — the effective
  state wins. If a channel was auto-disabled by new-api, the plugin only changes priorities and will
  not re-enable it; enable it in the new-api console.
- Credit priority is a 1.5.0 host feature: **restart DSH** after upgrading, otherwise the UI hides
  the control automatically because the `routing` field is missing.
- The daily credit budget is **enforced by the gateways**; the plugin only displays it and never
  throttles or switches accounts. Without the fields (old gateways) or when the Qoder panel
  `/accounts` read fails, the UI falls back to the 1.3.0 "today's usage" rendering (Qoder keeps the
  last successfully fetched budget values); the Qoder panel `/accounts` view only covers the
  current realm, so accounts in other realms may lack budget data.
- Built against the current DSH `slots` / `webServer` / `session/event` mechanisms; major DSH
  changes may require follow-up work.

## Development

```bash
npm run check   # node --check index.js && node --check client.js
```

- No runtime dependencies; no `npm install` needed.
- Host-half changes require a DSH restart; client-half changes only a page refresh.
- When adding UI strings, update both the `ZH` and `EN` tables in `client.js` (they are the fallback
  used by `translateWith`).
- `locale/*.json` is display metadata for the DSH plugin market and only reads `meta.title` /
  `meta.description`; keep `locale/zh.json` and `locale/en.json` in sync when the plugin blurb
  changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for details and [CHANGELOG.md](CHANGELOG.md) for release
history.

## License

[MIT](LICENSE) © 2026 dsh-free-egg-credits contributors

## Disclaimer

This project is not affiliated with WorkBuddy, Qoder or DeepSeek, and it does not include any
upstream service or reverse-proxy gateway implementation. It is only a presentation layer that
reads the public HTTP APIs of gateways running on your own machine. Using third-party gateways may
be subject to their own terms; you are responsible for complying with them.
