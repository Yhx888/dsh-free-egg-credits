/**
 * Free Egg 积分插件 Host 半。
 *
 * 职责（浏览器半只负责展示）：
 *   1. 读本地 workbuddy2api 网关的面板接口，拿国内账号的可用积分与实测积分单价；
 *   2. 判定每日签到状态：每天首次打开界面时调用一次单号签到接口（上游对重复签到
 *      返回「今天已签到」且幂等），据此得到权威状态；
 *   3. 从 Session 事件折叠每条对话每一轮的 token 用量，按实测单价折算积分；
 *   4. 通过同源 HTTP 路由把快照交给浏览器半（网关密钥不出 Host）。
 *
 * 配置项见 cordis.patch.yml 注释；所有配置都可省略。
 */
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Host 插件硬依赖：同源路由承载。 */
export const inject = ['webServer']

const ROUTE_PREFIX = '/__dsh-wb-credits'

/** 缺省配置：与 cordis.patch.yml 保持一份口径。 */
const DEFAULTS = {
  gatewayBaseUrl: 'http://127.0.0.1:7863',
  gatewayConfigPath: '',
  apiKey: '',
  realms: ['cn'],
  autoCheckin: true,
  checkinAfterHour: 8,
  checkinRetryMinutes: 10,
  refreshSeconds: 30,
  creditsPer1k: {},
  qoder: null,
}

/** 包目录上两级的 config.json 是开发期默认网关配置位置（bundle 以链接方式安装时有效）。 */
const PACKAGE_CONFIG_PATH = (() => {
  try {
    return fileURLToPath(new URL('../../config.json', import.meta.url))
  } catch {
    return ''
  }
})()

export function apply(ctx, rawConfig = {}) {
  const opts = normalizeConfig(rawConfig)
  const state = createState()
  const log = makeLogger()
  const gateway = createGateway(opts, log)
  const qoderGateway = opts.qoder ? createQoderGateway(opts, log) : null
  const ledger = createLedger(ctx, log)
  const checkin = createCheckin(opts, gateway, state, log)

  // 会话事件：逐轮累计 token；同时记住最近活跃会话供设置页展示。
  ctx.on('session/event', (session, event) => {
    const id = session && typeof session.id === 'string' ? session.id : ''
    if (!id) return
    // 子代理会话不参与「最近活跃对话」的时间线，只进账本（被问到才展示）。
    if (!session.header || session.header.origin !== 'subagent') state.lastSessionId = id
    ledger.note(id, event)
  })

  const route = (path, handler) => {
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_PREFIX + path,
        handler: (req, res) => {
          Promise.resolve()
            .then(() => handler(req, res))
            .catch(error => {
              log('路由处理失败 ' + path, error)
              sendJson(res, 500, { ok: false, error: errorMessage(error) })
            })
        },
      }),
    )
  }

  async function refresh(force) {
    const work = refreshGateway(state, gateway, opts, log, force)
    if (qoderGateway) await refreshQoder(state, { qoder: qoderGateway }, log)
    return work
  }

  async function handleSnapshot(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const sessionId = url.searchParams.get('sessionId') || state.lastSessionId || ''
    await refresh(false)
    await checkin.maybeAuto(6000)
    if (sessionId) await ledger.ensure(sessionId)
    sendJson(res, 200, buildPayload(state, ledger, opts, sessionId))
  }

  async function handleSessions(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const limit = clampInt(url.searchParams.get('limit'), 1, 30, 6)
    await refresh(false)
    const cached = state.recentCache
    if (cached && Date.now() - cached.at < 60_000) {
      sendJson(res, 200, cached.payload)
      return
    }
    const payload = await listRecentSessions(ctx, ledger, state, opts, limit, log)
    state.recentCache = { at: Date.now(), payload }
    sendJson(res, 200, payload)
  }

  async function handleRefresh(req, res) {
    if ((req.method || '').toUpperCase() !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
      return
    }
    state.recentCache = null
    await refresh(true)
    await checkin.maybeAuto(8000)
    sendJson(res, 200, { ok: true, online: state.online, error: state.error })
  }

  async function handleCheckin(req, res) {
    if ((req.method || '').toUpperCase() !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
      return
    }
    const url = new URL(req.url || '/', 'http://localhost')
    const wanted = url.searchParams.get('uid')
    const uids = wanted
      ? [wanted]
      : state.accounts.map(account => account.uid)
    const known = new Set(state.accounts.map(account => account.uid))
    const targets = uids.filter(uid => known.has(uid))
    await checkin.probeAll(targets)
    state.recentCache = null
    await refresh(false)
    const results = targets.map(uid => ({ uid, record: state.checkin.get(uid) || null }))
    sendJson(res, 200, { ok: true, results })
  }

  async function handleQoderCheckin(req, res) {
    if ((req.method || '').toUpperCase() !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
      return
    }
    if (!qoderGateway) {
      sendJson(res, 200, { ok: false, error: 'qoder_disabled' })
      return
    }
    let result = null
    try {
      result = await qoderGateway.checkin()
    } catch (error) {
      log('Qoder 手动签到失败', error)
      sendJson(res, 200, { ok: false, error: errorMessage(error) })
      return
    }
    state.qoder = state.qoder && state.qoder.enabled ? state.qoder : { enabled: true }
    state.qoder.updatedAt = 0 // 强制下次 snapshot 重拉积分
    await refreshQoder(state, { qoder: qoderGateway }, log)
    const rows = Array.isArray(result?.results) ? result.results : []
    sendJson(res, 200, {
      ok: true,
      results: rows.map(row => ({
        uid: String(row.uid || ''),
        nickname: String(row.nickname || ''),
        ok: row.ok === true,
        message: typeof row.message === 'string' ? row.message : '',
        earned: toNumber(row.earned_credit),
      })),
    })
  }

  route('/snapshot', handleSnapshot)
  route('/sessions', handleSessions)
  route('/refresh', handleRefresh)
  route('/checkin', handleCheckin)
  route('/qoder/checkin', handleQoderCheckin)

  log(`已挂载：网关 ${opts.gatewayBaseUrl}，账号域 ${opts.realms.join(',')}`)
}

// ---------------------------------------------------------------------------
// 配置与通用工具
// ---------------------------------------------------------------------------

function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const realms = Array.isArray(source.realms)
    ? source.realms.map(value => String(value).trim()).filter(Boolean)
    : DEFAULTS.realms
  return {
    gatewayBaseUrl: trimSlash(String(source.gatewayBaseUrl || DEFAULTS.gatewayBaseUrl)),
    gatewayConfigPath: String(source.gatewayConfigPath || '').trim(),
    apiKey: String(source.apiKey || '').trim(),
    realms: realms.length > 0 ? realms : DEFAULTS.realms,
    autoCheckin: source.autoCheckin !== false,
    checkinAfterHour: clampInt(source.checkinAfterHour, 0, 23, DEFAULTS.checkinAfterHour),
    checkinRetryMinutes: clampInt(source.checkinRetryMinutes, 1, 720, DEFAULTS.checkinRetryMinutes),
    refreshSeconds: clampInt(source.refreshSeconds, 5, 3600, DEFAULTS.refreshSeconds),
    creditsPer1k: source.creditsPer1k && typeof source.creditsPer1k === 'object' ? source.creditsPer1k : {},
    // Qoder 反代网关（qoder2api-hub）：null = 未配置不启用
    qoder: normalizeQoder(source.qoder),
  }
}

/** Qoder 网关子配置：只认 baseUrl / panelPasswordFile / panelPassword / enabled。 */
function normalizeQoder(raw) {
  if (!raw || typeof raw !== 'object') return null
  const baseUrl = trimSlash(String(raw.baseUrl || '')).trim()
  if (!baseUrl) return null
  const password = String(raw.panelPassword || '').trim()
  const passwordFile = String(raw.panelPasswordFile || '').trim()
  return {
    baseUrl,
    // 密码文件优先（panelPasswordFile），内联密码兜底；都没有则回退面板默认 admin
    panelPasswordFile: passwordFile,
    panelPassword: password,
    enabled: raw.enabled !== false,
  }
}

function makeLogger() {
  const prefix = '[free-egg-credits]'
  return (message, error) => {
    if (error === undefined) {
      console.log(`${prefix} ${message}`)
      return
    }
    console.warn(`${prefix} ${message}:`, error && error.message ? error.message : error)
  }
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.floor(number)))
}

function stripRealm(model) {
  return String(model || '').replace(/^(cn|global):/i, '')
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100
}

function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function dateKey(date = new Date()) {
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function sendJson(res, status, payload) {
  if (res.headersSent) {
    res.end()
    return
  }
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

// ---------------------------------------------------------------------------
// 网关客户端
// ---------------------------------------------------------------------------

function createGateway(opts, log) {
  let apiKeyCache = ''
  let apiKeyAt = 0

  async function apiKey(force = false) {
    if (!force && apiKeyCache && Date.now() - apiKeyAt < 60_000) return apiKeyCache
    if (opts.apiKey) {
      apiKeyCache = opts.apiKey
      apiKeyAt = Date.now()
      return apiKeyCache
    }
    const path = opts.gatewayConfigPath || PACKAGE_CONFIG_PATH
    if (!path) throw new Error('未配置网关 api_key（gatewayConfigPath 为空）')
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    const key = typeof parsed?.api_key === 'string' ? parsed.api_key.trim() : ''
    if (!key) throw new Error(`网关配置 ${path} 里没有 api_key`)
    apiKeyCache = key
    apiKeyAt = Date.now()
    return apiKeyCache
  }

  async function request(path, options = {}) {
    const { method = 'GET', timeoutMs = 8000, retryAuth = true } = options
    const key = await apiKey(!retryAuth)
    const response = await fetch(opts.gatewayBaseUrl + path, {
      method,
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 401 && retryAuth) {
      await apiKey(true)
      return request(path, { ...options, retryAuth: false })
    }
    const text = await response.text()
    if (!response.ok) throw new Error(`网关 ${method} ${path} → HTTP ${response.status}: ${text.slice(0, 200)}`)
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new Error(`网关 ${method} ${path} 返回非 JSON: ${text.slice(0, 120)}`)
    }
  }

  return {
    baseUrl: opts.gatewayBaseUrl,
    overview: () => request('/panel/api/overview'),
    checkin: uid =>
      request(`/panel/api/accounts/${encodeURIComponent(uid)}/checkin`, { method: 'POST', timeoutMs: 60_000 }),
  }
}

// ---------------------------------------------------------------------------
// Qoder 反代网关客户端（外部项目 qoder2api-hub，不在本仓库内）
// 面板接口无 CORS 且需要 panel token，只能由 Host 侧调用；密钥不出 Host。
// ---------------------------------------------------------------------------

function createQoderGateway(opts, log) {
  const qoder = opts.qoder
  let tokenCache = ''
  let passwordCache = ''
  // 密码文件的 mtime：面板密码被改（文件重写）后必须重读，否则进程会一直用旧密码登录 401
  let passwordFileMtime = 0
  let passwordMtimeChecked = false

  async function panelPassword() {
    if (qoder.panelPasswordFile) {
      try {
        const info = await stat(qoder.panelPasswordFile)
        if (passwordCache && passwordMtimeChecked && info.mtimeMs === passwordFileMtime) {
          return passwordCache
        }
        const raw = await readFile(qoder.panelPasswordFile, 'utf8')
        const value = raw.trim()
        if (value) {
          passwordCache = value
          passwordFileMtime = info.mtimeMs
          passwordMtimeChecked = true
          return passwordCache
        }
      } catch (error) {
        log('读取 Qoder 面板密码文件失败 ' + qoder.panelPasswordFile, error)
      }
    }
    if (!passwordCache) passwordCache = qoder.panelPassword || 'admin'
    return passwordCache
  }

  /** 登录失败时丢弃缓存的密码与 token，下次调用会重读密码文件。 */
  function invalidateAuth() {
    tokenCache = ''
    passwordCache = ''
    passwordMtimeChecked = false
  }

  async function login() {
    const password = await panelPassword()
    const response = await fetch(qoder.baseUrl + '/panel/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(8000),
    })
    const text = await response.text()
    let body = null
    try { body = JSON.parse(text) } catch { /* 非 JSON 按失败处理 */ }
    if (!response.ok || !body?.token) {
      throw new Error(`Qoder 面板登录失败 HTTP ${response.status}`)
    }
    tokenCache = String(body.token)
    return tokenCache
  }

  async function request(pathname, { method = 'GET', timeoutMs = 20000 } = {}) {
    if (!tokenCache) await login()
    const response = await fetch(qoder.baseUrl + pathname, {
      method,
      headers: { 'x-panel-token': tokenCache, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 401) {
      invalidateAuth()
      await login()
      return request(pathname, { method, timeoutMs })
    }
    const text = await response.text()
    if (!response.ok) throw new Error(`Qoder 网关 ${method} ${pathname} → HTTP ${response.status}: ${text.slice(0, 160)}`)
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`Qoder 网关 ${method} ${pathname} 返回非 JSON`)
    }
  }

  return {
    enabled: qoder.enabled,
    baseUrl: qoder.baseUrl,
    // 积分汇总：/credits/summary 是 API-key 域的只读接口，本地网关默认免密
    credits: async () => {
      const response = await fetch(qoder.baseUrl + '/credits/summary', {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`Qoder /credits/summary → HTTP ${response.status}`)
      return JSON.parse(text)
    },
    // 手动签到（设置页按钮用）；调度器每日 09/21 自动跑，这里只是手动补
    checkin: async () => request('/accounts/checkin', { method: 'POST', timeoutMs: 300000 }),
    accounts: () => request('/accounts'),
    // 调度器状态：拿最近/下次签到时间，界面与 WorkBuddy 的签到口径对齐
    scheduler: () => request('/scheduler'),
  }
}

/**
 * Qoder 调度器状态 → 与 WorkBuddy 同形的签到记录。
 * 网关调度器每日 09:00/21:00 巡检签到；当天跑过即视为「今日已签到」。
 */
function qoderCheckinView(scheduler) {
  if (!scheduler || typeof scheduler !== 'object') return null
  const last = typeof scheduler.last_run_time === 'string' ? scheduler.last_run_time : ''
  if (!last) return null
  const at = parseGatewayTime(last)
  if (!at) return null
  const sameDay = dateKey(at) === dateKey()
  return {
    date: dateKey(at),
    at: at.toISOString(),
    state: sameDay ? 'checked' : 'unknown',
    message: sameDay ? '今日已签到（调度器自动领取）' : '今日尚未到签到时间',
    fresh: false,
    nextAt: typeof scheduler.next_run_time === 'string' ? scheduler.next_run_time : '',
  }
}

/** 网关时间格式 "2026-10-18 13:54:25"（本地时间，无时区后缀）。 */
function parseGatewayTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value).trim())
  if (!match) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return new Date(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6] || 0),
  )
}

/**
 * 把 Qoder 网关的积分摘要并入快照。账号每行转成与 WorkBuddy 账号同形的状态行，
 * realm 固定 'qoder'，前端按 realm 分组渲染。
 */
async function refreshQoder(state, gateway, log) {
  const qoder = gateway.qoder
  if (!state.qoder) {
    // 首轮没有任何快照时也要有承载 fetching 标记的对象
    state.qoder = { enabled: false, online: false, accounts: [], totalCredits: 0, error: '', updatedAt: 0 }
  }
  if (!qoder || !qoder.enabled) {
    state.qoder = { online: false, enabled: false, accounts: [], totalCredits: 0, error: '', updatedAt: 0 }
    return
  }
  const now = Date.now()
  const cached = state.qoder
  if (cached && cached.enabled && now - cached.updatedAt < 60_000) return
  if (cached && cached.fetching) return cached.fetching
  const work = (async () => {
    try {
      const [summary, scheduler] = await Promise.all([
        qoder.credits(),
        qoder.scheduler().catch(() => null),
      ])
      const accounts = (Array.isArray(summary?.accounts) ? summary.accounts : []).map(row => ({
        uid: String(row.uid || ''),
        nickname: String(row.nickname || ''),
        realm: 'qoder',
        // 上游 registered 口径：remain = 剩余，size = 总额度
        credits: toNumber(row.credits_remain),
        creditsTotal: toNumber(row.credits_size),
        used: toNumber(row.credits_used),
        cooling: false,
        disabled: false,
        disabledReason: '',
        lastSuccess: row.registered_at ? new Date(toNumber(row.registered_at) * 1000).toISOString() : '',
        rateLimitedModels: [],
        degradeUntil: '',
        consecutiveFails: 0,
        modelCosts: [],
        // 签到状态与 WorkBuddy 对齐：调度器最近一次巡检即当日签到
        checkin: qoderCheckinView(scheduler),
      }))
      state.qoder = {
        enabled: true,
        online: true,
        baseUrl: qoder.baseUrl,
        accounts,
        totalCredits: toNumber(summary?.totals?.remain),
        error: '',
        updatedAt: Date.now(),
      }
    } catch (error) {
      // 保留上次成功快照，只标记离线，避免网关重启瞬间侧边栏闪空
      const keep = cached && cached.enabled ? cached : null
      state.qoder = {
        enabled: true,
        online: false,
        baseUrl: qoder.baseUrl,
        accounts: keep ? keep.accounts : [],
        totalCredits: keep ? keep.totalCredits : 0,
        error: errorMessage(error),
        updatedAt: Date.now(),
      }
      log('Qoder 网关快照失败', error)
    }
  })()
  state.qoder.fetching = work
  try {
    await work
  } finally {
    if (state.qoder) state.qoder.fetching = null
  }
}

// ---------------------------------------------------------------------------
// 快照状态
// ---------------------------------------------------------------------------

function createState() {
  return {
    accounts: [],
    pool: null,
    version: '',
    price: {},
    priceDetail: [],
    priceBasis: 'none',
    online: false,
    error: '',
    updatedAt: 0,
    lastAttemptAt: 0,
    fetching: null,
    checkin: new Map(),
    probing: new Set(),
    probeAt: new Map(),
    lastSessionId: '',
    recentCache: null,
    qoder: null,
  }
}

/**
 * 拉取网关快照。offline 时做 10 秒退避，避免页面每次轮询都等满超时。
 */
async function refreshGateway(state, gateway, opts, log, force) {
  const now = Date.now()
  if (!force) {
    if (state.fetching) return state.fetching
    if (state.updatedAt && now - state.updatedAt < opts.refreshSeconds * 1000) return
    if (!state.online && now - state.lastAttemptAt < 10_000) return
  }
  if (state.fetching) return state.fetching
  state.lastAttemptAt = now
  state.fetching = (async () => {
    try {
      const overview = await gateway.overview()
      applyOverview(state, overview, opts)
      state.online = true
      state.error = ''
    } catch (error) {
      state.online = false
      state.error = errorMessage(error)
      log('网关快照失败', error)
    } finally {
      state.updatedAt = Date.now()
      state.fetching = null
    }
  })()
  return state.fetching
}

function applyOverview(state, overview, opts) {
  const rawAccounts = Array.isArray(overview?.accounts) ? overview.accounts : []
  const wanted = new Set(opts.realms)
  state.accounts = rawAccounts
    .filter(account => account && wanted.has(String(account.realm || '')))
    .map(account => ({
      uid: String(account.uid || ''),
      nickname: String(account.nickname || ''),
      realm: String(account.realm || ''),
      credits: toNumber(account.credits),
      creditsTotal: toNumber(account.credits_total),
      cooling: account.cooling === true,
      disabled: account.disabled === true,
      disabledReason: typeof account.disabled_reason === 'string' ? account.disabled_reason : '',
      lastSuccess: typeof account.last_success === 'string' ? account.last_success : '',
      // 模型级限流台账（6004）：每模型一行 until/reset_at，用于展示恢复日期
      rateLimitedModels: Array.isArray(account.rate_limited_models)
        ? account.rate_limited_models
            .filter(row => row && row.model)
            .map(row => ({
              model: String(row.model),
              until: typeof row.until === 'string' ? row.until : '',
              resetAt: typeof row.reset_at === 'string' ? row.reset_at : '',
              reason: typeof row.reason === 'string' ? row.reason : '',
            }))
        : [],
      // 连败降权截止（degrade_until 零值/已过时由展示侧过滤）
      degradeUntil: typeof account.degrade_until === 'string' ? account.degrade_until : '',
      consecutiveFails: toNumber(account.consecutive_fails),
      modelCosts: Array.isArray(account.model_costs)
        ? account.model_costs
            .filter(row => row && row.model)
            .map(row => ({
              model: String(row.model),
              costPer1k: toNumber(row.cost_per_1k),
              samples: toNumber(row.samples),
              lastSeen: typeof row.last_seen === 'string' ? row.last_seen : '',
            }))
        : [],
    }))
  state.pool = {
    total: toNumber(overview?.total),
    healthy: toNumber(overview?.healthy),
    cooling: toNumber(overview?.cooling),
    disabled: toNumber(overview?.disabled),
  }
  state.version = typeof overview?.version === 'string' ? overview.version : ''
  buildPrice(state, opts)
}

/**
 * 积分单价：按 (账号, 模型) 实测扣费的 EMA × 样本数加权，得到每个模型的
 * 积分/千 token；配置 creditsPer1k 覆盖优先。
 */
function buildPrice(state, opts) {
  const models = new Map()
  for (const account of state.accounts) {
    for (const row of account.modelCosts) {
      const model = stripRealm(row.model)
      if (!model || !Number.isFinite(row.costPer1k) || row.costPer1k < 0) continue
      const samples = Math.max(1, Math.floor(row.samples) || 1)
      const current = models.get(model) || { weighted: 0, samples: 0, rows: [] }
      current.weighted += row.costPer1k * samples
      current.samples += samples
      current.rows.push({
        uid: account.uid,
        name: account.nickname || account.uid.slice(0, 8),
        costPer1k: row.costPer1k,
        samples,
      })
      models.set(model, current)
    }
  }

  const price = {}
  const detail = []
  for (const [model, current] of models) {
    if (current.samples <= 0) continue
    const value = current.weighted / current.samples
    price[model] = value
    detail.push({ model, costPer1k: value, samples: current.samples, accounts: current.rows, source: 'gateway' })
  }

  let overridden = false
  for (const [rawModel, rawValue] of Object.entries(opts.creditsPer1k || {})) {
    const model = stripRealm(rawModel)
    const value = Number(rawValue)
    if (!model || !Number.isFinite(value) || value < 0) continue
    price[model] = value
    const existing = detail.find(row => row.model === model)
    if (existing) {
      existing.costPer1k = value
      existing.source = 'config'
    } else {
      detail.push({ model, costPer1k: value, samples: 0, accounts: [], source: 'config' })
    }
    overridden = true
  }

  state.price = price
  state.priceDetail = detail.sort((left, right) => left.model.localeCompare(right.model))
  state.priceBasis = Object.keys(price).length === 0 ? 'none' : overridden ? 'config' : 'gateway'
}

// ---------------------------------------------------------------------------
// Session 账本：逐轮 token
// ---------------------------------------------------------------------------

function usageTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0
  const total = Number(usage.totalTokens)
  if (Number.isFinite(total) && total > 0) return total
  const input = toNumber(usage.inputTokens)
  const output = toNumber(usage.outputTokens)
  return input + output > 0 ? input + output : 0
}

function modelOfEvent(event) {
  const source = event?.data?.message?.source
  return source && typeof source.model === 'string' ? source.model : ''
}

function createLedger(ctx, log) {
  const sessions = new Map()

  function entry(id) {
    let current = sessions.get(id)
    if (!current) {
      current = { turns: new Map(), loaded: false, loading: null }
      sessions.set(id, current)
    }
    return current
  }

  function accumulate(target, turn, tokens, model) {
    const current = target.get(turn) || { tokens: 0, models: new Set() }
    current.tokens += tokens
    if (model) current.models.add(model)
    target.set(turn, current)
  }

  function note(sessionId, event) {
    if (!event || event.type !== 'assistant/message') return
    const data = event.data || {}
    const tokens = usageTokens(data.usage)
    const turn = Number(data.turn)
    if (tokens <= 0 || !Number.isFinite(turn)) return
    accumulate(entry(sessionId).turns, turn, tokens, modelOfEvent(event))
  }

  async function readEvents(sessionId) {
    const sessionsService = ctx.get('sessions')
    if (sessionsService && typeof sessionsService.get === 'function') {
      const live = sessionsService.get(sessionId)
      if (live) {
        for (const method of ['ownEvents', 'snapshotEvents']) {
          if (typeof live[method] !== 'function') continue
          try {
            const events = live[method]()
            if (Array.isArray(events)) return events
          } catch {
            // 单个读取方式失败就换下一个
          }
        }
      }
    }
    const query = ctx.get('sessionQuery')
    if (query && typeof query.readSession === 'function') {
      try {
        const snapshot = await query.readSession(sessionId)
        const events = eventsFromSnapshot(snapshot)
        if (Array.isArray(events)) {
          // fork 会话的逻辑日志含父会话继承事件：按 inheritedEventCount 裁掉，
          // 否则会把父会话的用量重复算进本条对话。
          const inherited = Number(snapshot && snapshot.inheritedEventCount)
          return Number.isFinite(inherited) && inherited > 0 ? events.slice(inherited) : events
        }
      } catch (error) {
        log('读取会话日志失败 ' + shortId(sessionId), error)
      }
    }
    return null
  }

  async function ensure(sessionId) {
    const current = entry(sessionId)
    if (current.loaded) return current
    if (current.loading) {
      await current.loading
      return current
    }
    current.loading = (async () => {
      const events = await readEvents(sessionId)
      if (!Array.isArray(events)) return
      const folded = new Map()
      for (const event of events) {
        if (!event || event.type !== 'assistant/message') continue
        const data = event.data || {}
        const tokens = usageTokens(data.usage)
        const turn = Number(data.turn)
        if (tokens <= 0 || !Number.isFinite(turn)) continue
        accumulate(folded, turn, tokens, modelOfEvent(event))
      }
      // 日志折叠是权威全集；读取期间新到的实时轮次保留下来。
      for (const [turn, data] of current.turns) {
        if (!folded.has(turn)) folded.set(turn, data)
      }
      current.turns = folded
      current.loaded = true
    })()
      .catch(error => log('折叠会话用量失败 ' + shortId(sessionId), error))
      .finally(() => {
        current.loading = null
      })
    await current.loading
    return current
  }

  return { note, ensure, peek: id => sessions.get(id) }
}

function eventsFromSnapshot(result) {
  if (Array.isArray(result)) return result
  if (!result || typeof result !== 'object') return null
  for (const key of ['events', 'log', 'records', 'entries']) {
    if (Array.isArray(result[key])) return result[key]
  }
  for (const key of ['snapshot', 'session', 'data']) {
    const nested = result[key]
    if (nested && typeof nested === 'object' && Array.isArray(nested.events)) return nested.events
  }
  return null
}

function shortId(id) {
  return String(id || '').slice(0, 8)
}

// ---------------------------------------------------------------------------
// 签到
// ---------------------------------------------------------------------------

function createCheckin(opts, gateway, state, log) {
  function interpret(uid, result) {
    const message = typeof result?.checkin_message === 'string' ? result.checkin_message.trim() : ''
    const already = message !== '' && /已签到|already/i.test(message)
    const failed = message !== '' && !already
    const record = {
      date: dateKey(),
      at: new Date().toISOString(),
      state: failed ? 'failed' : 'checked',
      message,
      fresh: message === '',
    }
    state.checkin.set(uid, record)

    const account = state.accounts.find(item => item.uid === uid)
    if (account) {
      const credits = Number(result?.credits)
      const total = Number(result?.credits_total)
      if (Number.isFinite(credits)) account.credits = credits
      if (Number.isFinite(total)) account.creditsTotal = total
    }
    return record
  }

  async function probe(uid) {
    if (!uid || state.probing.has(uid)) return null
    state.probing.add(uid)
    try {
      return interpret(uid, await gateway.checkin(uid))
    } catch (error) {
      state.checkin.set(uid, {
        date: dateKey(),
        at: new Date().toISOString(),
        state: 'unknown',
        message: errorMessage(error),
        fresh: false,
      })
      log('签到探测失败 ' + shortId(uid), error)
      return null
    } finally {
      state.probing.delete(uid)
      state.probeAt.set(uid, Date.now())
    }
  }

  function pendingUids() {
    if (!opts.autoCheckin) return []
    if (new Date().getHours() < opts.checkinAfterHour) return []
    const day = dateKey()
    const out = []
    for (const account of state.accounts) {
      const record = state.checkin.get(account.uid)
      if (record && record.date === day && record.state === 'checked') continue
      const last = state.probeAt.get(account.uid) || 0
      if (Date.now() - last < opts.checkinRetryMinutes * 60_000) continue
      out.push(account.uid)
    }
    return out
  }

  async function maybeAuto(timeoutMs) {
    const uids = pendingUids()
    if (uids.length === 0) return
    const work = (async () => {
      for (const uid of uids) await probe(uid)
    })()
    if (!timeoutMs) {
      work.catch(() => {})
      return
    }
    await Promise.race([work, delay(timeoutMs)])
  }

  async function probeAll(uids) {
    for (const uid of uids) await probe(uid)
  }

  return { maybeAuto, probeAll, pendingUids }
}

// ---------------------------------------------------------------------------
// 组装响应
// ---------------------------------------------------------------------------

function estimateCredits(state, tokens, models) {
  if (!tokens || tokens <= 0) return 0
  const prices = []
  for (const model of models || []) {
    const value = state.price[stripRealm(model)]
    if (Number.isFinite(value)) prices.push(value)
  }
  if (prices.length === 0) return null
  const per1k = prices.reduce((sum, value) => sum + value, 0) / prices.length
  return round2((tokens * per1k) / 1000)
}

function sessionView(state, ledger, sessionId) {
  const id = String(sessionId || '')
  if (!id) return { id: '', turns: [], totalTokens: 0, totalCredits: 0, known: false, loaded: false }
  const current = ledger.peek(id)
  if (!current) return { id, turns: [], totalTokens: 0, totalCredits: 0, known: false, loaded: false }

  const turns = []
  let totalTokens = 0
  let totalCredits = 0
  let pricedTurns = 0
  let missingPrice = false
  for (const [turn, data] of [...current.turns.entries()].sort((left, right) => left[0] - right[0])) {
    const models = [...data.models]
    const credits = estimateCredits(state, data.tokens, models)
    if (credits === null) missingPrice = true
    else {
      totalCredits += credits
      pricedTurns += 1
    }
    totalTokens += data.tokens
    turns.push({ turn, tokens: data.tokens, models, credits })
  }
  return {
    id,
    turns,
    totalTokens,
    totalCredits: round2(totalCredits),
    pricedTurns,
    known: current.loaded || current.turns.size > 0,
    loaded: current.loaded,
    missingPrice,
  }
}

function buildPayload(state, ledger, opts, sessionId) {
  const accounts = state.accounts.map(account => ({
    uid: account.uid,
    nickname: account.nickname,
    realm: account.realm,
    credits: account.credits,
    creditsTotal: account.creditsTotal,
    cooling: account.cooling,
    disabled: account.disabled,
    disabledReason: account.disabledReason,
    lastSuccess: account.lastSuccess,
    rateLimitedModels: account.rateLimitedModels,
    degradeUntil: account.degradeUntil,
    consecutiveFails: account.consecutiveFails,
    checkin: state.checkin.get(account.uid) || null,
  }))
  const totalCredits = accounts.reduce((sum, account) => sum + account.credits, 0)
  const qoder = state.qoder && state.qoder.enabled
    ? {
        enabled: true,
        online: state.qoder.online,
        baseUrl: state.qoder.baseUrl || '',
        error: state.qoder.error || '',
        updatedAt: state.qoder.updatedAt ? new Date(state.qoder.updatedAt).toISOString() : '',
        totalCredits: state.qoder.totalCredits || 0,
        accounts: (state.qoder.accounts || []).map(account => ({
          uid: account.uid,
          nickname: account.nickname,
          realm: account.realm,
          credits: account.credits,
          creditsTotal: account.creditsTotal,
          used: account.used || 0,
          cooling: account.cooling,
          disabled: account.disabled,
          lastSuccess: account.lastSuccess,
          checkin: account.checkin || null,
        })),
      }
    : { enabled: false }
  return {
    ok: true,
    gateway: {
      baseUrl: opts.gatewayBaseUrl,
      online: state.online,
      error: state.error,
      updatedAt: state.updatedAt ? new Date(state.updatedAt).toISOString() : '',
      version: state.version,
      pool: state.pool,
      accounts,
      totalCredits,
      priceByModel: state.price,
      priceDetail: state.priceDetail,
      priceBasis: state.priceBasis,
      autoCheckin: opts.autoCheckin,
    },
    qoder,
    session: sessionView(state, ledger, sessionId),
    lastSessionId: state.lastSessionId,
    generatedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// 最近对话
// ---------------------------------------------------------------------------

function recordId(record) {
  if (!record || typeof record !== 'object') return ''
  const candidates = [record.id, record.sessionId, record.header?.id, record.session?.id]
  for (const value of candidates) {
    if (typeof value === 'string' && value) return value
  }
  return ''
}

function recordTime(record) {
  if (!record || typeof record !== 'object') return ''
  const candidates = [record.updatedAt, record.activityAt, record.lastActivityAt, record.header?.createdAt]
  for (const value of candidates) {
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) continue
    const ms = number > 1e12 ? number : number * 1000
    return new Date(ms).toISOString()
  }
  return ''
}

async function readTitles(query, ids) {
  const titles = new Map()
  if (ids.length === 0) return titles
  if (typeof query.readTitleSnapshots === 'function') {
    try {
      const list = await query.readTitleSnapshots(ids)
      if (Array.isArray(list)) {
        for (const item of list) {
          const id = item?.sessionId || item?.id || item?.header?.id
          const title = item?.title || item?.snapshot?.title || item?.value?.title || item?.observation?.title
          if (typeof id === 'string' && typeof title === 'string' && title) titles.set(id, title)
        }
      }
    } catch {
      // 标题只是装饰信息，失败就留空
    }
  }
  if (titles.size > 0 || typeof query.readTitle !== 'function') return titles
  for (const id of ids.slice(0, 8)) {
    try {
      const snapshot = await query.readTitle(id)
      const title = snapshot?.title || snapshot?.snapshot?.title || snapshot?.value?.title
      if (typeof title === 'string' && title) titles.set(id, title)
    } catch {
      // 忽略单个会话的标题读取失败
    }
  }
  return titles
}

async function listRecentSessions(ctx, ledger, state, opts, limit, log) {
  const query = ctx.get('sessionQuery')
  if (!query || typeof query.listSessions !== 'function') {
    return { ok: true, supported: false, items: [], error: '' }
  }
  let records
  try {
    records = await query.listSessions()
  } catch (error) {
    log('列出会话失败', error)
    return { ok: true, supported: true, items: [], error: errorMessage(error) }
  }
  if (!Array.isArray(records)) return { ok: true, supported: true, items: [], error: '' }

  const picked = records.slice(0, limit)
  const ids = picked.map(recordId).filter(Boolean)
  const titles = await readTitles(query, ids)

  const items = []
  for (const record of picked) {
    const id = recordId(record)
    if (!id) continue
    try {
      await ledger.ensure(id)
      const view = sessionView(state, ledger, id)
      items.push({
        id,
        title: titles.get(id) || '',
        turns: view.turns.length,
        tokens: view.totalTokens,
        credits: view.totalCredits,
        missingPrice: view.missingPrice === true,
        updatedAt: recordTime(record),
      })
    } catch (error) {
      log('汇总会话失败 ' + shortId(id), error)
    }
  }
  return { ok: true, supported: true, items, error: '' }
}
