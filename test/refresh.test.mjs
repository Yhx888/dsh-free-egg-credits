// 手动刷新回归测试：/refresh 必须绕过签到重试节流。
// 场景：账号签到失败后 10 分钟内点「刷新」，仍应重新探测一次签到状态；
// 否则重登/补签后侧栏会一直停在旧的 failed/401。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

const PREFIX = '/__dsh-wb-credits'

let checkinCalls = 0

const gateway = createServer((req, res) => {
  const send = payload => {
    const body = JSON.stringify(payload)
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    res.end(body)
  }
  if (req.url === '/panel/api/overview') {
    send({
      accounts: [{
        uid: 'acc-1',
        nickname: 'acc',
        realm: 'cn',
        credits: 100,
        credits_total: 100,
        success_count: 1,
        last_success: '2026-10-23T09:00:00+08:00',
        consecutive_fails: 0,
      }],
      total: 1,
      healthy: 1,
      cooling: 0,
      disabled: 0,
      version: 'test',
    })
    return
  }
  if (req.url === '/v1/models') {
    send({ data: [] })
    return
  }
  if (req.url === '/panel/api/accounts/acc-1/checkin') {
    checkinCalls += 1
    send({
      checkin_message: 'upstream client (http 401): session dead',
      credits: 100,
      credits_total: 100,
    })
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
  autoCheckin: true,
  checkinAfterHour: 0,
  checkinRetryMinutes: 10,
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

const first = await request('GET', '/snapshot')
assert.equal(first.gateway.accounts[0].checkin.state, 'failed')
assert.equal(checkinCalls, 1, '首次快照探测一次签到')

// 10 分钟重试窗口内点「刷新」：必须强制再探测，不能被 checkinRetryMinutes 拦掉。
const refreshed = await request('POST', '/refresh')
assert.equal(refreshed.ok, true)
assert.equal(checkinCalls, 2, '手动刷新应绕过节流重新探测签到')

console.log('refresh tests passed')
gateway.close()
