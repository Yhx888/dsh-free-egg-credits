# 安全策略

## 报告漏洞

请通过 GitHub 的私密漏洞报告提交：
<https://github.com/Yhx888/dsh-free-egg-credits/security/advisories/new>

不要在公开 issue 里贴凭据或可直接利用的细节。一般 7 天内回复。

## 凭据边界

- 本仓库不含任何网关密钥、面板密码或账号 token。插件运行期从本机文件读取它们
  （`gatewayConfigPath` 指向的网关 `config.json`、`qoder.panelPasswordFile`），且只在 Host 进程内使用。
- 浏览器半只拿到同源 HTTP 路由返回的积分 / 签到快照，响应里不含密钥。
- 若你在 issue / PR 里贴出 `api_key`、`panelPassword`、`x-panel-token` 等内容，
  请先撤销该凭据再提交。

## 攻击面

- 插件路由挂在 DSH Web 的同源 `webServer` 下（路径前缀 `/__dsh-wb-credits`），
  依赖 DSH 自身的登录认证。不要把 DSH 端口在没有认证层的情况下暴露到公网。
- `POST /checkin` 只接受快照里已存在的账号 uid，不会代理任意 URL。
- 插件不发起除「本机网关地址」以外的网络请求，也不上报任何遥测。
