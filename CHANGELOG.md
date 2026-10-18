# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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

[1.0.0]: https://github.com/Yhx888/dsh-free-egg-credits/releases/tag/v1.0.0
