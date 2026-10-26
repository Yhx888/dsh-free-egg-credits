// Qoder 展示口径回归测试（三条都是「界面说的和网关实际不一样」）：
// 1) 退化账本（@credits 全 null）不能被当成 0 分——Number(null) === 0；
// 2) 签到状态以网关 /tasks 的 daily_checkin 为准：claimed=今天已领取（带金额），
//    not_accepted=上游没下发活动；面板 lastCheckin 只是本地盖章，会假绿/假黄；
// 3) /accounts 必须带 realm=all，否则跨区（intl）账号拿不到 lastCheckin 行。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

const PREFIX = '/__dsh-wb-credits'

const pad = value => String(value).padStart(2, '0')
const stamp = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
const today = new Date()
const at = (hour, minute, dayOffset = 0) =>
  stamp(new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, hour, minute, 9))

const taskCalls = []
const accountsQueries = []

const gateway = createServer((req, res) => {
  const send = payload => {
    const body = JSON.stringify(payload)
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    res.end(body)
  }
  const url = new URL(req.url || '/', 'http://localhost')
  if (req.method === 'POST' && url.pathname === '/panel/login') {
    send({ token: 'test-token' })
    return
  }
  if (url.pathname === '/panel/api/overview') {
    send({ accounts: [], total: 0, healthy: 0, cooling: 0, disabled: 0, version: 'test' })
    return
  }
  if (url.pathname === '/v1/models') {
    send({ data: [] })
    return
  }
  if (url.pathname === '/credits/summary') {
    // q1：退化账本（余量未知）；q2：正常账本
    send({
      accounts: [
        { uid: 'q1', nickname: 'intl-account', credits_remain: null, credits_size: null, credits_used: null, registered_at: 0 },
        { uid: 'q2', nickname: 'cn-account', credits_remain: 300, credits_size: 500, credits_used: 200, registered_at: 0 },
      ],
      totals: { remain: 300, size: 500, used: 200 },
    })
    return
  }
  if (url.pathname === '/scheduler') {
    send({ enabled: true, last_run_time: at(10, 45), next_run_time: at(21, 0) })
    return
  }
  if (url.pathname === '/accounts') {
    accountsQueries.push(url.search)
    // q1 面板 lastCheckin 停在昨天（旧口径会判「今日尚未签到」），q2 是今天 11:00（旧口径假绿）
    send({ accounts: [
      { uid: 'q1', lastCheckin: at(9, 0, -1) },
      { uid: 'q2', lastCheckin: at(11, 0) },
    ] })
    return
  }
  if (url.pathname === '/tasks') {
    const uid = url.searchParams.get('uid')
    taskCalls.push(uid)
    if (uid === 'q1') {
      send({ tasks: [{ task_code: 'daily_checkin', status: 'claimed', description: '今日已领取 +100 Credits（每天领 100 Credits），明日再来' }] })
      return
    }
    send({ tasks: [{ task_code: 'daily_checkin', status: 'not_accepted', description: '当前账号暂无可参与的官方活动' }] })
    return
  }
  if (url.pathname === '/models') {
    send({ data: [] })
    return
  }
  if (url.pathname === '/usage') {
    send({ by_model: {} })
    return
  }
  if (url.pathname === '/usage/recent') {
    send({ rows: [] })
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve))
const gatewayBaseUrl = `http://127.0.0.1:${gateway.address().port}`

const handlers = new Map()
const ctx = {
  effect: fn => fn(),
  on() {},
  get() { return undefined },
  webServer: {
    register({ path, handler }) {
      handlers.set(path, handler)
      return () => handlers.delete(path)
    },
  },
}

const { apply } = await import('../index.js')
apply(ctx, {
  gatewayBaseUrl,
  apiKey: 'test',
  autoCheckin: false,
  qoder: { baseUrl: gatewayBaseUrl, panelPassword: 'test' },
})

async function request(method, path) {
  const pathname = (PREFIX + path).split('?')[0]
  const handler = handlers.get(pathname)
  assert.ok(handler, `route ${pathname} registered`)
  let done
  const settled = new Promise(resolve => { done = resolve })
  const res = {
    status: 0,
    body: '',
    headersSent: false,
    writeHead(status) { this.status = status; this.headersSent = true },
    end(body) { this.body = body === undefined ? '' : String(body); done() },
  }
  handler({ method, url: PREFIX + path, headers: {} }, res)
  await settled
  return JSON.parse(res.body)
}

const snapshot = await request('GET', '/snapshot')
const [q1, q2] = snapshot.qoder.accounts

assert.equal(accountsQueries.length > 0, true, '应请求 Qoder 账号列表')
assert.equal(accountsQueries[0], '?realm=all', '/accounts 必须带 realm=all 才能拿到跨区账号')

assert.equal(q1.credits, undefined, '退化账本的 credits 应为未知（undefined），不能是 0')
assert.notEqual(q1.credits, 0, '余额未知不能显示成 0 分')
assert.equal(q1.checkin.state, 'checked', 'q1 的 /tasks 是 claimed：今天确实领到了')
assert.match(q1.checkin.label || '', /今日已领取/, '绿点文案要带网关的领取说明')

assert.equal(q2.credits, 300, '正常账本余额照旧')
assert.equal(q2.checkin.state, 'pending', 'q2 的 /tasks 是 not_accepted：不能因为面板 lastCheckin 是今天就说已签到')
assert.match(q2.checkin.message || '', /无可领取/, '要说明上游没下发活动，而不是「今日尚未签到」')

assert.deepEqual(taskCalls.sort(), ['q1', 'q2'], '每次刷新每个账号拉一次任务视图')

// 60 秒内的下一次快照：Qoder 快照走缓存，任务视图不能再打上游
await request('GET', '/snapshot')
assert.equal(taskCalls.length, 2, '缓存期内不应重复请求 /tasks')

console.log('qoder checkin tests passed')
gateway.close()
