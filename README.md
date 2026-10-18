<p align="center"><img src="icon.svg" width="72" height="72" alt="Free Egg Credits icon"></p>

# Free Egg Credits

[中文](README.md) | [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-3c873a.svg)](package.json)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4b8bf5.svg)](https://github.com/topics/dsh-plugin)

一个 DSH（DeepSeek Harness）Web 界面插件：把本地反代网关
（WorkBuddy / Qoder）里各账号的**可用积分**、**每日签到状态**，以及**每条对话折算消耗的积分**
直接显示在界面里——侧边栏、输入框下方、每轮对话末尾和设置页各有一个落点。

> 积分为**折算值**：单价取自网关对上游 `usage.credit` 的实测台账，界面统一带 `≈` 标记。

## 界面落点

- **侧边栏底部（账户行上方）**：账号积分区块。每行统一为「状态点 · 账号名 · 来源徽标（WB/Qoder） · 余额」，
  签到状态只由最左侧状态点表达（绿色 = 今日已签到）；限流 / 降权 / 连败以徽标透出恢复时间。侧边栏收起时不占位。
- **输入框下方**：当前对话累计消耗（`Free Egg · 本会话 ≈N 积分`）。
- **每条对话末尾**：该轮折算消耗（`本轮 ≈N 积分`，悬停可看 token 与模型）。
- **设置 → Free Egg 积分**：账号卡（名称 / 来源徽标 / 余额 / 签到状态 / 已用占比 / 立即签到）、
  限流与降权明细、折算单价、最近对话与逐轮明细。

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
| `creditsPer1k` | `{}` | 单价覆盖（模型名 → 积分/千 token） |
| `qoder` | 无 | Qoder 网关子配置：`baseUrl`、`panelPasswordFile`（面板密码文件）、`panelPassword`（内联兜底）、`enabled`。不配置则不启用 Qoder 来源 |

## 数据来源

| 数据 | 来源 |
|---|---|
| WorkBuddy 账号积分 | 网关面板 `GET /panel/api/overview`（`realm=cn` 的账号） |
| WorkBuddy 签到状态 | 当天首次打开界面时调用一次单号签到接口（`POST /panel/api/accounts/{uid}/checkin`）。上游对重复签到返回 `10001 今天已签到`，幂等无副作用；未签到时顺带完成当天签到 |
| Qoder 账号积分 | Qoder 网关 `GET /credits/summary`（registered 口径：`credits_remain` / `credits_size`） |
| Qoder 签到状态 | Qoder 网关 `GET /scheduler`：调度器当天跑过巡检即视为「今日已签到」，`next_run_time` 为下次巡检 |
| 每轮 token | DSH Session 事件里的 `assistant/message.usage`（Host 侧折叠，不落盘） |
| 积分单价 | 网关账号状态里的 `model_costs[].cost_per_1k`（按样本数加权），可在配置里覆盖 |
| 限流状态 | 网关账号状态里的 `rate_limited_models[]`（6004 模型级限流台账：model / until / reset_at）与 `degrade_until`（连败降权截止），到期自动消失。**重置时间**取上游 `reset_at`（真正恢复可用的时刻，缺省回落 `until`），侧边栏徽标标成「限流 HH:mm（多模型取最晚）」；设置页把 `until` 单列为「本地冷却到」 |

## 工作原理

插件分 Host / Client 两半：

- **Host 半（`index.js`）**：`inject: ['webServer']`，在 DSH Web 同源路由 `/__dsh-wb-credits`
  下注册 5 个接口（`GET /snapshot`、`GET /sessions`、`POST /refresh`、`POST /checkin`、
  `POST /qoder/checkin`）。负责：读网关面板、判定签到、用 `session/event` 与会话日志折叠每轮
  token 用量、按实测单价折算积分。密钥、面板密码、token 全部只在这个进程内使用。
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
- 非 WorkBuddy 模型（例如 stepfun）的历史对话只显示 token，积分为 `—`。
- 签到状态依赖一次幂等的签到调用；关闭 `autoCheckin` 后状态可能为「未知」。
- Qoder 积分为上游 registered 口径（`credits_remain` / `credits_size`），签到或消费后由网关写回；
  快照缓存 60 秒，设置页点刷新可强制重拉。
- 契合最新 DSH 的 `slots` / `webServer` / `session/event` 机制；DSH 大版本改动后可能需要跟进适配。

## 开发与贡献

```bash
npm run check   # node --check index.js && node --check client.js
```

- 零运行时依赖，不需要 `npm install`。
- Host 半改动需重启 DSH；Client 半改动刷新页面即可。
- 新增界面文案时同时补 `client.js` 里 `ZH` / `EN` 两份词条。

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

[MIT](LICENSE) © 2026 Yhx888

## 免责声明

本项目与 WorkBuddy / Qoder / DeepSeek 官方无关，也不包含任何上游服务或反代网关的实现；
它只是一个读取本机网关公开 HTTP 接口的展示层。使用第三方网关可能受其各自条款约束，
请在遵守相关服务条款的前提下自行承担使用风险。
