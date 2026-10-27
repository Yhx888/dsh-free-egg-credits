# 一键部署：网关 + New API + 插件配置

这个目录里的脚本把整套 `Free Egg` 后端装到本机，省掉「分别下载三个项目、改四份配置、再装插件」的重复劳动：

| 组件 | 作用 | 默认地址 |
|---|---|---|
| [WorkBuddy2API](https://github.com/linguo2625469/workbuddy2api-panel) | WorkBuddy / CodeBuddy 账号池网关 | http://127.0.0.1:7863/panel/ |
| [Qoder2API-Hub](https://github.com/shuishuipingan/qoder2api-hub) | Qoder 国内 / 国际多账号反代网关 | http://127.0.0.1:8790/ |
| [New API](https://github.com/QuantumNous/new-api) | 聚合入口（DSH 只连它） | http://127.0.0.1:3001/ |
| 本插件 | 积分 / 签到 / 消耗展示 + 优先消耗切换 | DSH 侧边栏 |

安装器只负责**下载、写配置、启动**；账号登录仍在各自面板完成（OAuth / 扫码），凭据只留在本机。

## 用法

```powershell
# 1. 取得本仓库（任选其一）
git clone https://github.com/Yhx888/dsh-free-egg-credits.git
cd dsh-free-egg-credits

# 2. 先看计划（不下载、不写文件）
powershell -ExecutionPolicy Bypass -File .\install\windows.ps1 -DryRun

# 3. 正式安装（默认 %LOCALAPPDATA%\FreeEggStack，端口 7863 / 8790 / 3001）
powershell -ExecutionPolicy Bypass -File .\install\windows.ps1
```

装完会打印三个面板地址与《使用指引》（`<安装目录>\使用指引.md`），按里面的 4 步登录账号、建 New API 渠道、写入 DSH 配置即可。

## 参数

| 参数 | 说明 |
|---|---|
| `-InstallRoot` | 安装目录，默认 `%LOCALAPPDATA%\FreeEggStack` |
| `-WbPort` / `-QoderPort` / `-NewApiPort` | 三个端口，默认 `7863` / `8790` / `3001` |
| `-Profile` | DSH profile 名，默认 `desktop`；装了插件且检测到 profile 时自动写入插件配置 |
| `-SkipWorkBuddy` / `-SkipQoder` / `-SkipNewApi` | 跳过某个组件 |
| `-SkipPluginConfig` | 不碰 `cordis.patch.yml`，只生成 `dsh-snippets.yml` / `dsh-provider.yml` |
| `-NoStart` | 只安装，不启动 |
| `-AutoStart` | 注册登录自启（HKCU Run，名 `FreeEggStack`） |
| `-Force` | 覆盖组件与配置（账号、数据库、密钥不会被删） |

## 目录结构

```
%LOCALAPPDATA%\FreeEggStack\
├─ workbuddy\       wb2api.exe / config.json / auths / data
├─ qoder\           qoder2api-hub 源码 / python（内置 3.12）/ accounts / usage
├─ newapi\          new-api.exe / one-api.db
├─ logs\            三个服务的 stdout / stderr / pid
├─ start-stack.ps1  幂等启动（已监听的端口跳过）
├─ stop-stack.ps1   只停本目录启动的进程
├─ status.ps1       查看三个端口状态
├─ 使用指引.md       登录 + 配置的完整步骤
├─ dsh-snippets.yml 插件配置段
└─ dsh-provider.yml DSH provider 片段
```

## 升级与卸载

- **升级**：先 `stop-stack.ps1`，再重跑安装器（可加 `-Force`）；账号、数据库、密钥保留。
- **卸载**：先 `stop-stack.ps1`；删除 HKCU Run 的 `FreeEggStack`（若注册过）；再删除安装目录。删除前自行备份 `newapi\one-api.db` 与账号目录。

## 安全说明

- 三个服务默认只监听 `127.0.0.1`，不要映射到公网。
- 三个上游项目都是独立开源项目（WorkBuddy2API / Qoder2API-Hub 为 MIT，New API 为 AGPL-3.0），安装器只下载官方 release、按各自的默认方式启动，不修改它们的代码。
- 插件配置、面板密码、New API token 都只写在本机；不要提交到 Git。

## 杀软误报

安装器是「下载 + 解压 + 启动本地服务」的 PowerShell 脚本，部分国产杀软（如火绒）会启发式报
`HEUR:TrojanDownloader/PS.NetLoader`。这是**误报**：脚本只从本项目 README 里列出的官方 GitHub /
python.org 地址下载，所有下载都做 SHA256 校验，不访问其它域名。若被拦截，请把
`install\windows.ps1` 加入信任区，或先手动下载三个组件放到 `.cache` 再运行。
