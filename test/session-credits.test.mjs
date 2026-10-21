// 单会话积分回归测试：用假 ctx 注入合成 session 事件 + 假网关，不依赖真实环境。
// 重点覆盖：input/cache/output 分类型折算、旧事件回落、creditsPer1k 覆盖。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

const PREFIX = '/__dsh-wb-credits'
const eventsBySession = new Map()

const gateway = createServer((req, res) => {
  const send = payload => {
    const body = JSON.stringify(payload)
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    res.end(body)
  }
  if (req.url === '/panel/api/overview') {
    send({
      accounts: [{
        uid: 'test-account',
        nickname: 'test',
        realm: 'cn',
        credits: 1000,
        credits_total: 1000,
        model_costs: [
          { model: 'deepseek-v4.1-flash', cost_per_1k: 0.5, samples: 1 },
          { model: 'legacy-model', cost_per_1k: 0.5, samples: 1 },
        ],
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
    send({
      data: [
        { id: 'cn:deepseek-v4.1-flash', credits: 'x0.11' },
        { id: 'cn:legacy-model', credits: 'x1' },
      ],
    })
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve))
const gatewayBaseUrl = `http://127.0.0.1:${gateway.address().port}`

function events(model, usage, turn = 1) {
  return [{
    type: 'assistant/message',
    time: 1,
    data: {
      turn,
      usage,
      message: { source: { provider: 'free-egg', model } },
    },
  }]
}

function loadInstance(config) {
  const handlers = new Map()
  const ctx = {
    effect: fn => fn(),
    on() {},
    get(name) {
      if (name !== 'sessions') return undefined
      return {
        get(id) {
          const list = eventsBySession.get(id)
          return list ? { ownEvents: () => list } : undefined
        },
      }
    },
    webServer: {
      register({ path, handler }) {
        handlers.set(path, handler)
        return () => handlers.delete(path)
      },
    },
  }
  apply(ctx, { gatewayBaseUrl, apiKey: 'test', autoCheckin: false, ...config })
  return async path => {
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
    handler({ method: 'GET', url: PREFIX + path, headers: {} }, res)
    await settled
    return JSON.parse(res.body)
  }
}

const { apply } = await import('../index.js')

eventsBySession.set('token-types', events('deepseek-v4.1-flash', {
  inputTokens: 1000,
  cacheReadTokens: 0,
  outputTokens: 100,
  totalTokens: 1100,
}))
eventsBySession.set('cache-discount', events('deepseek-v4.1-flash', {
  inputTokens: 0,
  cacheReadTokens: 100000,
  outputTokens: 0,
  totalTokens: 100000,
}))
eventsBySession.set('legacy', events('legacy-model', { totalTokens: 100000 }))

const defaults = loadInstance({})
const typed = (await defaults('/snapshot?sessionId=token-types')).session
assert.equal(typed.totalCredits, 0.02, 'cold input + output should be ≈0.02')
assert.equal(typed.turns[0].inputTokens, 1000)
assert.equal(typed.turns[0].outputTokens, 100)

const cached = (await defaults('/snapshot?sessionId=cache-discount')).session
assert.equal(cached.totalCredits, 0.02, 'cached input should be ≈0.02')

// 旧事件只有 totalTokens：按配置的混合单价回落，而不是按 0 token 计价。
const legacy = loadInstance({ creditsPer1k: { 'legacy-model': 1 } })
const legacySession = (await legacy('/snapshot?sessionId=legacy')).session
assert.equal(legacySession.totalCredits, 100, 'legacy total-only event uses blended rate')

// creditsPer1k 是最高优先级：配置后不再套用 tokenRates。
const override = loadInstance({ creditsPer1k: { 'deepseek-v4.1-flash': 1 } })
const overrideSession = (await override('/snapshot?sessionId=token-types')).session
assert.equal(overrideSession.totalCredits, 1.1, 'creditsPer1k wins over token rates')

// tokenRates 可覆盖内置分类型单价（含全 0 = 免费）。
const custom = loadInstance({
  tokenRates: { 'deepseek-v4.1-flash': { input: 0, cache: 0, output: 0 } },
})
const customSession = (await custom('/snapshot?sessionId=token-types')).session
assert.equal(customSession.totalCredits, 0, 'custom tokenRates override')

await new Promise(resolve => gateway.close(resolve))
console.log('session-credits tests passed')
