# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.3.0] - 2026-10-19

### 新增

- **会话级消耗账号固定**：每个会话在首轮回复后把「承载账号」固定下来，之后不再换号；侧边栏高亮
  跟着**前台会话**切换，不再跟随全局最近一次请求，两个会话并发时不会来回跳。
- **每个账号的「今日消耗」**：账号行新增小图标 + 小框（向下箭头 + 积分）。WorkBuddy 用两次快照的
  余额下降量累计（网关按上游 `credit` 扣减余额），账本落盘 `<DSH_HOME>/free-egg-credits/daily.json`，
  重启 DSH 续算；Qoder 用当天 `/usage/recent` 台账逐条累加 `credit`（精确值）。
- 设置页账号卡同步展示「今日消耗」。

### 说明

- 归属要等这一轮回复结束、网关完成用量回写后才更新（流式生成期间不变）。
- WorkBuddy 的当日消耗从新版首次拿到余额基线后开始累计：网关没有按日积分接口，首次运行当天可能
  只从运行时算起；账本落盘后重启 DSH 不会清零。

## [1.2.0] - 2026-10-19

### 新增

- **侧边栏实时消耗账号**：正在消耗积分的账号行会加上**灰色底框（选中态）**，跟着每轮对话实时切换；
  2 分钟内有新请求且当前对话使用 free-egg 模型时整行高亮，否则不高亮。不额外占一行、不加顶部提示框。
- 消耗归属来自两个网关的请求完成回写：WorkBuddy 面板 `token_usage.last_used_at`，
  Qoder 面板 `GET /usage/recent`（3 秒缓存）；一轮回复结束后 Host 侧延迟 1.5 秒强制拉一次网关，
  合并同一轮的多条事件。
- 客户端快照轮询从 15 秒收紧到 5 秒，「实时」感更强（页面隐藏时跳过）。

### 说明

- 流式回复期间网关还没记录该次请求，归属要等这一轮结束才更新（通常回复结束后数秒内）；
  更早的历史请求不参与判定，只看两侧最近一次。

## [1.1.2] - 2026-10-18

### 修复

- **WorkBuddy 限流重置时间不显示**：网关 `/panel/api/overview` 的
  `rate_limited_models[].reset_at` 在无上游重置文案时输出 Go 零值
  `0001-01-01T00:00:00Z`（`time.Time` 的 `omitempty` 对结构体不生效）。插件原样透传后，
  客户端 `Date.parse` 得到负数，`reset_at || until` 的回落失效：侧边栏徽标只剩「限流」
  没有 HH:mm，设置页则显示 0001 年的日期。现 Host 侧统一归一：早于 1970 的时间视为
  缺失，限流回落到 `until`（如「限流 18:13」）；`degrade_until`、`last_success`、
  `last_seen` 等透传时间字段统一过归一，避免同类零值产生「01-01 08:00」式假日期
  （网关侧 `time.Time` 值类型 + `omitempty` 的通病；本仓库只做展示层兼容）。

## [1.1.1] - 2026-10-18

### 修复

- **积分预估高估 3 倍**：原实现用 WorkBuddy 的 `model_costs` 反推「每倍率多少积分」，
  再乘目录倍率高估算；但 Qoder 侧单价受缓存命中影响很大（本会话 57M token 里 98% 是缓存
  命中），且两台网关的倍率基线并不相同。现改为：
  - 读取 Qoder 面板 `GET /usage` 的 `by_model` 实测台账（真实 `credit ÷ total_tokens`），
    作为 Qoder 模型的实测单价；
  - WorkBuddy / Qoder 各自用本网关实测数据校准倍率基线，不再跨网关混用；
  - free-egg 聚合别名（如 `deepseek-v4.1-flash` 实际由 Qoder `DeepSeek-Flash` 承载）按
    「去版本号归一 + 实测」兜底匹配；免费模型（倍率 0）恒为 0，不参与实测匹配。
- 同一会话实测从 ≈385 修正为 ≈117 积分（Qoder `/usage` 台账真实值 117.86），误差 <1%。

### 说明

- 实测单价包含缓存命中的折扣，属于「该模型近期实际平均」，会随用法变化；需要精确值仍可用
  `creditsPer1k` 覆盖。

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

[1.3.0]: https://github.com/Yhx888/dsh-free-egg-credits/releases/tag/v1.3.0
[1.2.0]: https://github.com/Yhx888/dsh-free-egg-credits/releases/tag/v1.2.0
[1.1.1]: https://github.com/Yhx888/dsh-free-egg-credits/releases/tag/v1.1.1
[1.1.0]: https://github.com/Yhx888/dsh-free-egg-credits/releases/tag/v1.1.0
[1.0.0]: https://github.com/Yhx888/dsh-free-egg-credits/releases/tag/v1.0.0
