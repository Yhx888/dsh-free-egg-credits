# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.0] - 2026-10-18

### 新增

- **free-egg 模型的底栏常显**：只要当前对话使用 free-egg provider（默认
  `free-egg` / `workbuddy` / `qoder` / `new-api`）的模型，输入框下方就显示积分预估——
  首轮回复前显示 `≈0`，模型暂无单价时提示「等待单价」；换到其他 provider 的模型则隐藏。
- **未实测模型的估价**：读取 WorkBuddy `/v1/models` 的 `credits` 倍率与 Qoder `/models` 的
  `price_factor`，以本机实测单价为基线折算，倍率 0 视为免费模型（0 积分）。
- 会话事件记录 provider（`assistant/message.source.provider`，以及 `model/selection`、
  `request/header` 的当前选择），按 provider 判断是否 free-egg 并决定是否计积分。
- 设置页折算单价区标注「估算」并区分实测 / 倍率折算口径。

### 变更

- 积分单价改为三层：网关实测台账 → 目录倍率折算 → 配置 `creditsPer1k` 覆盖。
- 新增配置 `freeEggProviders`、`catalogBaseCreditsPer1k`。

## [1.0.0] - 2026-10-18

首个开源版本。

### 新增

- 侧边栏底部账号积分区块：WorkBuddy / Qoder 账号共用「状态点 · 账号名 · 来源徽标 · 余额」行，
  签到状态由状态点表达，限流 / 降权 / 连败以徽标透出恢复时间。
- 输入框下方显示当前会话累计消耗积分；每条对话末尾显示该轮折算积分（悬停看 token 与模型）。
- 设置页「Free Egg 积分」：账号卡（余额 / 签到 / 已用占比 / 立即签到）、限流明细、
  折算单价、最近对话与当前对话逐轮明细。
- Host 半读取 WorkBuddy2API 网关面板与 qoder2api-hub 网关接口，网关密钥与面板密码只在 Host 侧使用。
- 每日签到探测：当天首次打开界面时调用一次幂等签到接口；支持手动签到。
- 中英文界面文案（`locale/zh.json`、`locale/en.json` 与 Client 内建回退）。

### 说明

- 积分是**折算值**：单价取自网关对上游 `usage.credit` 的实测台账，界面统一带 `≈`。
- 两个网关都是外部依赖，不在本仓库内；未配置时对应来源不显示。

[1.1.0]: https://github.com/Yhx888/dsh-free-egg-credits/releases/tag/v1.1.0
[1.0.0]: https://github.com/Yhx888/dsh-free-egg-credits/releases/tag/v1.0.0
