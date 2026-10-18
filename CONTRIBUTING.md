# 参与贡献

欢迎 issue 与 PR。改动前请先读一遍 [README](README.md) 的「工作原理」与「已知限制」。
参与本项目即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 开发环境

- Node.js >= 20（仓库零运行时依赖，不需要 `npm install`）
- 一个可用的 DSH（DeepSeek Harness）Web GUI
- 可选：WorkBuddy2API / qoder2api-hub 网关，用于联调真实数据；没有网关时可以只改界面层

## 本地调试

1. 用 `link:` 把本仓库装进某个 DSH profile（步骤见 README「安装」的「本地开发」）。
2. 提交前跑语法检查：

   ```bash
   npm run check
   ```

3. 改 Host 半（`index.js`）需要重启 DSH 生效；只改 Client 半（`client.js`）刷新页面即可。

## 代码约定

- 纯 Node ESM，不新增运行时依赖；Host 半只 import `node:` 内置模块。
- Host 半负责读取网关 / 折叠会话用量，Client 半只负责展示；密钥不得下发浏览器。
- 新增界面文案时，同时补 `client.js` 里 `ZH` / `EN` 两份词条。
- 注释写「为什么」，不写「做了什么」。

## 提交

- 提交信息用中文，一句话说清改动与原因。
- 一个 PR 只做一件事，不夹带无关格式化。
- 不要把真实凭据、账号昵称、内网地址写进代码、测试或截图。

## 安全

见 [SECURITY.md](SECURITY.md)。
