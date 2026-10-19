<p align="center"><img src="icon.svg" width="72" height="72" alt="Free Egg Credits icon"></p>

# Free Egg Credits

[中文](README.md) | [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-3c873a.svg)](package.json)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4b8bf5.svg)](https://github.com/topics/dsh-plugin)

一个 DSH（DeepSeek Harness）Web 界面插件：把本地反代网关
（WorkBuddy / Qoder）里各账号的**可用积分**、**每日积分预算（已用 / 上限 / 剩余 / 满额）**、
**每日签到状态**，以及**每条对话折算消耗的积分**直接显示在界面里——侧边栏、输入框下方、
每轮对话末尾和设置页各有一个落点。

> 积分为**折算值**：WorkBuddy 用账号 `model_costs` 台账、Qoder 用面板 `/usage` 台账（真实 `credit ÷ total_tokens`）作为实测单价；未实测的模型按各网关的模型目录倍率折算，界面统一带 `≈` 标记。

## 界面落点

- **侧边栏底部（账户行上方）**：账号积分区块。每行统一为「状态点 · 账号名 · 来源徽标（WB/Qoder） · 今日消耗 · 余额」，
  签到状态只由最左侧状态点表达（绿色 = 今日已签到）；限流 / 降权 / 连败以徽标透出恢复时间。侧边栏收起时不占位。
  **选中逻辑按前台会话固定**：每个会话在首轮回复后固定一个承载账号，之后不再换号；切换前台会话只会切换
  高亮行，不会跟着全局最近请求来回跳。正在消耗的账号行加**灰色底框（选中态）**，不额外占一行。
  每行还有一个「今日消耗」小框（向下小箭头 + 积分）：WorkBuddy 按余额差值累计、Qoder 按用量台账精确累加。
  网关启用每日积分预算后改为「已用/上限」（如 `118/100`），满额时用宿主警示色标出（悬停见
  「今日已满额，已停用，明日 0 点恢复」）；全部账号满额时区块底部多一行「今日额度已用完」提示。
- **输入框下方**：当前对话累计消耗（`Free Egg · 本会话 ≈N 积分`）。只要当前对话用的是 free-egg provider
  （默认 `free-egg` / `workbuddy` / `qoder` / `new-api`）的模型，这条就常显——首轮回复前是 `≈0`，
  模型暂时没有单价时提示「等待单价」；换到其他 provider（如 DeepSeek 官方账号）的模型则不显示，避免误导。
- **每条对话末尾**：该轮折算消耗（`本轮 ≈N 积分`，悬停可看 token 与模型）。
- **设置 → Free Egg 积分**：账号卡（名称 / 来源徽标 / 余额 / 签到状态 / 已用占比 /
  今日已用 ≈X / 上限（剩余 ≈Y） / 立即签到）、限流与降权明细、折算单价、最近对话与逐轮明细；
  全部账号满额时页面顶部加一行提示。

WorkBuddy 与 Qoder 账号共用同一套行 / 卡片结构，只以来源徽标区分。

## 安装

插件本身零运行时依赖，只要一个能跑 DSH Web GUI 的环境。

### 方式一：从 GitHub 安装

```bash
dsh plugin --profile web add github:Yhx888/dsh-free-egg-credits
```

安装后按「配置」一节写配置，再重启 DSH 生效。

> 官方桌面端托管的 `desktop` profile 会被 CLI 拒绝（`managed exclusively by the Electron application`），
> 这类环境请用下面的手动 link 方式。

### 方式二：手动 link（桌面端 / 本地开发）

插件通过 `link:` 依赖装进 DSH profile，不进 `node_modules` 拷贝，改完源码重启 DSH 即生效：

```jsonc
// ~/.dsh/profiles/<profile>/package.json
"dependencies": {
  "dsh-free-egg-credits": "link:/absolute/path/to/dsh-free-egg-credits"
},
"dsh": { "profile": { "bundles": [ "...", "dsh-free-egg-credits" ] } }
```

```powershell
# 建链接（junction 不需要管理员权限）
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\<profile>\node_modules\dsh-free-egg-credits" `
  -Target "C:\absolute\path\to\dsh-free-egg-credits"
```

改完 Host 半（`index.js`）需重启 DSH；只改 Client 半（`client.js`）刷新页面即可。

## 外部依赖（可选，缺省则对应来源不显示）

| 依赖 | 用途 | 相关配置 |
|---|---|---|
| [WorkBuddy2API 网关](https://github.com/linguo2625469/workbuddy2api-panel)（`workbuddy2api`） | WorkBuddy / CodeBuddy 账号积分与签到 | `gatewayBaseUrl`、`gatewayConfigPath` |
| [Qoder 反代网关](https://github.com/shuishuipingan/qoder2api-hub)（`qoder2api-hub`） | Qoder 账号积分与签到调度 | `qoder.baseUrl`、`qoder.panelPasswordFile` |

两个网关都**不是**本插件的组成部分；插件只读它们的 HTTP 接口。
网关密钥与面板密码只在 Host 侧读取、不下发浏览器。

## 配置

写在目标 profile 的 `cordis.patch.yml`（插件 id：`free-egg-credits`）：

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

> 这一层的 `config` 是**整体替换** bundle 层配置，不是深合并：一旦写了 `qoder`，
> `qoder` 下的字段要一起写全（`baseUrl` 必填，`panelPasswordFile` / `panelPassword` / `enabled` 可选）。

| 字段 | 默认 | 说明 |
|---|---|---|
| `gatewayBaseUrl` | `http://127.0.0.1:7863` | WorkBuddy 网关地址 |
| `gatewayConfigPath` | 包目录上两级 `config.json` | 从网关配置读取 `api_key`。默认值只对「插件放在网关仓库内」的开发期布局有效；独立目录安装时必须显式指向网关 `config.json`，否则读不到密钥、网关判离线、侧边栏只剩标题没有账号行 |
| `apiKey` | 空 | 直接给密钥（优先于配置文件） |
| `realms` | `[cn]` | 统计哪些域；国内账号即 `cn` |
| `autoCheckin` | `true` | 是否自动补签 / 探测签到状态 |
| `checkinAfterHour` | `8` | 几点后才自动探测（避免凌晨误触发） |
| `checkinRetryMinutes` | `10` | 失败重试间隔 |
| `refreshSeconds` | `30` | 网关快照缓存 |
| `creditsPer1k` | `{}` | 单价覆盖（模型名 → 积分/千 token），优先级最高 |
| `freeEggProviders` | `['free-egg','workbuddy','qoder','new-api']` | 哪些 DSH provider 视为「free-egg 模型」：这些 provider 的对话底栏常显积分预估，且只有它们计积分 |
| `catalogBaseCreditsPer1k` | `0` | 目录倍率折算的兜底基线（积分/千 token/倍率单位）；`0` = 只用网关实测台账自动校准 |
| `qoder` | 无 | Qoder 网关子配置：`baseUrl`、`panelPasswordFile`（面板密码文件）、`panelPassword`（内联兜底）、`enabled`。不配置则不启用 Qoder 来源 |

## 每日积分预算（网关层强制）

每日预算与选号都由**网关**强制，插件只负责读字段展示（不参与限流、不参与换号）。本机参考配置：

- **WorkBuddy**（`workbuddy2api` 的 `config.json` → `pool`）：`daily_credit_limit = 100`（`0` = 关闭）
  + `prefer_credits = true`（健康候选按余额从高到低优先）。
- **Qoder**（`qoder2api-hub` 面板「设置 → 每日积分限额」）：按域的 `daily_credit_limit = 100`（`cn`）。

生效后的行为：

- 账号当天累计消耗达到上限（WorkBuddy `daily_credit_spent >= daily_credit_limit`；Qoder
  `creditLimitReached = true`）后，网关不再把新请求分给该账号（粘性会话路径也会拒绝并让上层重新选号）；
- 同一网关内优先使用**余额最高**的账号，直到它达上限被跳过；
- 四个账号（WorkBuddy 2 + Qoder 2）都满额后，new-api 的 `qwen-fallback` 渠道会把 DeepSeek 请求
  自动降级到 Qwen3.8-Flash（免费）继续跑；WB/Qoder 恢复额度后自动回到 DeepSeek。

插件侧的展示：

- 侧边栏账号行的小框在启用预算时显示「已用/上限」（如 `118/100`），满额时用宿主警示色标出，
  tooltip 明确「今日已满额，已停用，明日 0 点恢复」；未启用预算时仍是原来的「≈N 积分」。
- 设置页账号卡显示「今日已用 ≈X / 100（剩余 ≈Y）」，满额时多一行提示。
- 一次快照里**所有**账号（WorkBuddy + Qoder 合计，至少一个）都满额时，设置页顶部与侧边栏
  各给一行提示：「今日额度已用完：DeepSeek 已自动降级到 Qwen3.8-Flash（免费）」。

> 旧网关没有每日预算字段，或 Qoder 面板 `/accounts` 读取失败时，插件自动回落到旧的「今日消耗」
> 展示（Qoder 会沿用上一次成功拿到的预算值），不会让整次刷新失败。

## 数据来源

| 数据 | 来源 |
|---|---|
| WorkBuddy 账号积分 | 网关面板 `GET /panel/api/overview`（`realm=cn` 的账号） |
| WorkBuddy 签到状态 | 当天首次打开界面时调用一次单号签到接口（`POST /panel/api/accounts/{uid}/checkin`）。上游对重复签到返回 `10001 今天已签到`，幂等无副作用；未签到时顺带完成当天签到 |
| Qoder 账号积分 | Qoder 网关 `GET /credits/summary`（registered 口径：`credits_remain` / `credits_size`） |
| Qoder 签到状态 | Qoder 网关 `GET /scheduler`：调度器当天跑过巡检即视为「今日已签到」，`next_run_time` 为下次巡检 |
| 会话消耗账号 | WorkBuddy 面板 `token_usage.last_used_at` / `last_model`；Qoder 面板 `GET /usage/recent`（`account` / `model` / `at`，3 秒缓存）。每轮回复结束后 Host 侧延迟 1.5 秒刷新两侧网关，按事件时刻就近匹配到该会话；首次匹配后固定，不再换号 |
| 账号当日消耗 | WorkBuddy：累加两次快照之间的余额下降量（网关按上游 `credit` 扣减账号余额），账本落盘 `<DSH_HOME>/free-egg-credits/daily.json`，重启 DSH 继续算；Qoder：当天 `/usage/recent` 台账的 `credit` 逐条累加（精确值） |
| 每日积分预算 / 今日已用 | WorkBuddy：面板 `GET /panel/api/overview` 账号行的 `daily_credit_spent` / `daily_credit_limit` / `daily_credit_capped`；Qoder：面板 `GET /accounts`（面板 token 已封装）的 `dailyCreditsToday` / `dailyCreditLimit` / `creditLimitReached`，与 `/credits/summary` 并进同一次刷新（保留 60 秒缓存）。字段缺失（旧网关）时保持 undefined/0/false，界面回落旧的「今日消耗」样式；`/accounts` 失败只让预算字段缺省，不影响 Qoder 积分刷新 |
| 每轮 token | DSH Session 事件里的 `assistant/message.usage`（Host 侧折叠，不落盘） |
| 积分单价（WorkBuddy 实测） | 网关账号状态里的 `model_costs[].cost_per_1k`（按样本数加权） |
| 积分单价（Qoder 实测） | Qoder 面板 `GET /usage` 的 `by_model` 台账：真实 `credit ÷ total_tokens`（含缓存命中折扣），5 分钟缓存 |
| 积分单价（未实测） | 模型目录倍率：WorkBuddy `GET /v1/models` 的 `credits`（如 `x0.11`）、Qoder `GET /models` 的 `price_factor`；两台网关各自用本网关实测数据校准基线；倍率为 `0` 视为免费模型（0 积分） |
| free-egg 聚合别名 | 如 `deepseek-v4.1-flash` 实际由 Qoder `DeepSeek-Flash` 承载时，用「去版本号归一 + 实测单价」兜底匹配；歧义时可用 `creditsPer1k` 覆盖 |
| 模型来源 | DSH Session 事件里 `assistant/message.message.source.provider` / `model`，以及 `model/selection`、`request/header` 事件的当前 provider / model（据此判断算不算 free-egg 模型） |
| 限流状态 | 网关账号状态里的 `rate_limited_models[]`（6004 模型级限流台账：model / until / reset_at）与 `degrade_until`（连败降权截止），到期自动消失。**重置时间**取上游 `reset_at`（真正恢复可用的时刻，缺省回落 `until`），侧边栏徽标标成「限流 HH:mm（多模型取最晚）」；设置页把 `until` 单列为「本地冷却到」 |

## 工作原理

插件分 Host / Client 两半：

- **Host 半（`index.js`）**：`inject: ['webServer']`，在 DSH Web 同源路由 `/__dsh-wb-credits`
  下注册 5 个接口（`GET /snapshot`、`GET /sessions`、`POST /refresh`、`POST /checkin`、
  `POST /qoder/checkin`）。负责：读网关面板与模型目录、判定签到、用 `session/event` 与会话日志折叠每轮
  token 用量、按 provider 判断是否 free-egg 模型、按「实测单价 → 目录倍率折算 → 配置覆盖」折算积分；
  并在每轮回复结束后刷新 WorkBuddy `token_usage` 与 Qoder `/usage/recent`，按事件时刻把这次消耗
  归属并固定在对应会话（会话 → 账号不再来回切）；同时维护每个账号的「今日消耗」账本
  （WorkBuddy 余额差值 + 落盘续算，Qoder 台账精确累加），并映射网关侧的每日积分预算字段
  （WB `/panel/api/overview`；Qoder `/accounts`，best-effort 且失败保留上次值），供侧边栏展示。
  密钥、面板密码、token 全部只在这个进程内使用。
- **Client 半（`client.js`）**：手写 `window.__ModuleLoader__` bundle，向 `sidebar.footer.action`、
  `conversation.composer.dock`、`conversation.chat.turnTail`、`settings.section` 四个席位注入 React 组件，
  只从上面的同源路由取数据。界面沿用宿主 CSS 变量（`--dsw-alias-*`），不引入独立样式体系。

签到是「探测式」的：当天第一次打开界面时对未签到的账号调用一次幂等签到接口，据返回判定状态；
不想让插件自动补签时把 `autoCheckin` 设为 `false`，此时状态可能显示未知，可在设置页手动点「立即签到」。

## 隐私与安全

- **无遥测**：插件只访问配置里写的本机网关地址，不向任何第三方服务发请求。
- **凭据不出 Host**：WorkBuddy `api_key` 从网关 `config.json` 读取，Qoder 面板密码从密码文件读取，
  都不会出现在浏览器拿到的快照里。
- **接口不代理任意 URL**：签到接口只接受快照里已存在的账号 uid。
- 插件路由依赖 DSH 自身的登录认证；**不要把 DSH 端口在没有认证层的情况下暴露到公网**。

发现安全问题请按 [SECURITY.md](SECURITY.md) 私密报告。

## 已知限制

- 积分为折算值：上游限免时段实际扣费可能更低，所以界面统一带 `≈`。
- 账号归属来自网关**请求完成后的回写**：流式生成期间不会变，要等这一轮结束才更新（通常数秒内）。归属按会话固定，两个并发会话各记各的账号；但如果首轮归属就匹配错（两个会话的请求完成时刻太接近），该会话会一直沿用第一次结果——这是「不来回切」的取舍。
- WorkBuddy 的「当日消耗」需要先有余额基线：新版 Host 在某个账号上第一次看到余额后开始累计，首次运行当天可能只从运行时算起（网关没有按日积分接口）；账本落盘后重启 DSH 不会清零。Qoder 的当日消耗来自用量台账，可从当天 0 点起精确重算。
- 只有 free-egg provider（默认 `free-egg` / `workbuddy` / `qoder` / `new-api`）的对话计积分；其他 provider（如 DeepSeek 官方账号）只显示 token、积分为 `—`，底栏也不显示。
- 未实测模型的单价是**倍率折算的估算值**：两台网关各自用本机实测数据校准，换模型 / 上游调价后可能有偏差；配置 `creditsPer1k` 可精确覆盖。
- Qoder 实测单价包含缓存命中的折扣（本项目实测一度有 98% 输入命中缓存），是「该模型近期实际平均」；同一模型换用法（缓存比例变化）会带来偏差。
- free-egg 聚合别名的自动匹配按「去版本号归一」进行，跨网关同名家族（如 DeepSeek-Flash / deepseek-v4.1-flash）能对上；若有歧义，用 `creditsPer1k` 显式指定。
- 签到状态依赖一次幂等的签到调用；关闭 `autoCheckin` 后状态可能为「未知」。
- Qoder 积分为上游 registered 口径（`credits_remain` / `credits_size`），签到或消费后由网关写回；
  快照缓存 60 秒，设置页点刷新可强制重拉。
- 每日积分预算的**强制**在网关侧：插件只读展示，不参与选号或拦截。旧网关没有预算字段、或
  Qoder 面板 `/accounts` 不可用时，界面回到 1.3.0 的「今日消耗」样式（Qoder 沿用上次成功值）；
  Qoder 面板 `/accounts` 默认只返回当前域的账号，跨域账号可能拿不到预算数据。
- 契合最新 DSH 的 `slots` / `webServer` / `session/event` 机制；DSH 大版本改动后可能需要跟进适配。

## 开发与贡献

```bash
npm run check   # node --check index.js && node --check client.js
```

- 零运行时依赖，不需要 `npm install`。
- Host 半改动需重启 DSH；Client 半改动刷新页面即可。
- 新增界面文案时同时补 `client.js` 里 `ZH` / `EN` 两份词条（`translateWith` 用它们兜底）。
- `locale/*.json` 是 DSH 插件市场展示用的元数据，只认 `meta.title` / `meta.description`；
  改插件介绍时同步更新 `locale/zh.json` 与 `locale/en.json`。

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

[MIT](LICENSE) © 2026 dsh-free-egg-credits contributors

## 免责声明

本项目与 WorkBuddy / Qoder / DeepSeek 官方无关，也不包含任何上游服务或反代网关的实现；
它只是一个读取本机网关公开 HTTP 接口的展示层。使用第三方网关可能受其各自条款约束，
请在遵守相关服务条款的前提下自行承担使用风险。
