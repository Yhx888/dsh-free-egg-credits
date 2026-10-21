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
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
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
  // 哪些 DSH provider 算「free-egg 模型」：这些 provider 的对话即使还没算出单价，
  // 底栏也要显示积分预估。
  freeEggProviders: ['free-egg', 'workbuddy', 'qoder', 'new-api'],
  // 目录倍率折算的兜底基线（积分/千 token/倍率单位）；0 = 只用实测台账自动校准。
  catalogBaseCreditsPer1k: 0,
  qoder: null,
  // new-api 管理面：配置后可在设置页切换「积分优先消耗平台」（改两个渠道的优先级）
  newApi: null,
}

/** 包目录上两级的 config.json 是开发期默认网关配置位置（bundle 以链接方式安装时有效）。 */
const PACKAGE_CONFIG_PATH = (() => {
  try {
    return fileURLToPath(new URL('../../config.json', import.meta.url))
  } catch {
    return ''
  }
})()

/**
 * 当日消耗账本落盘路径：<DSH_HOME>/free-egg-credits/daily.json。
 * WorkBuddy 网关不提供「按天积分」接口，只能靠余额差值累计；落盘后重启 DSH
 * 不会把当天已经累计的消耗清零（停机期间的消耗也会在首个快照差值里补上）。
 */
const DAILY_STATE_PATH = (() => {
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    return join(home, 'free-egg-credits', 'daily.json')
  } catch {
    return ''
  }
})()

/** 读当日账本（同步读，插件启动时只读一次；文件不存在/损坏/跨天一律视为没有）。 */
function loadDailyState() {
  if (!DAILY_STATE_PATH) return null
  try {
    const data = JSON.parse(readFileSync(DAILY_STATE_PATH, 'utf8'))
    if (!data || typeof data !== 'object' || data.date !== dateKey()) return null
    return data
  } catch {
    return null
  }
}

/** 原子写当日账本（tmp + rename）；失败只影响重启后的延续性，不影响当前展示。 */
async function saveDailyState(daily) {
  if (!DAILY_STATE_PATH || !daily) return
  const payload = JSON.stringify({
    date: daily.date,
    workbuddy: Object.fromEntries(daily.workbuddy),
    balances: Object.fromEntries(daily.wbCredits),
    updatedAt: new Date().toISOString(),
  })
  const tmp = DAILY_STATE_PATH + '.tmp'
  await mkdir(dirname(DAILY_STATE_PATH), { recursive: true })
  await writeFile(tmp, payload, 'utf8')
  await rename(tmp, DAILY_STATE_PATH)
}

/**
 * 优先消耗平台落盘路径：<DSH_HOME>/free-egg-credits/routing.json。
 * 只保存用户期望的优先平台；渠道优先级数字以 new-api 为准，不重复落盘。
 */
const ROUTING_STATE_PATH = (() => {
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    return join(home, 'free-egg-credits', 'routing.json')
  } catch {
    return ''
  }
})()

/** 读优先平台（同步读，启动时只读一次；文件不存在/损坏/取值非法一律视为没设置）。 */
function loadRoutingMode() {
  if (!ROUTING_STATE_PATH) return ''
  try {
    const data = JSON.parse(readFileSync(ROUTING_STATE_PATH, 'utf8'))
    const mode = data && typeof data.mode === 'string' ? data.mode : ''
    return mode === 'workbuddy' || mode === 'qoder' ? mode : ''
  } catch {
    return ''
  }
}

/** 原子写优先平台（tmp + rename）；失败只影响重启后的记忆，不影响本次切换结果。 */
async function saveRoutingMode(mode) {
  if (!ROUTING_STATE_PATH || !mode) return
  const payload = JSON.stringify({ mode, updatedAt: new Date().toISOString() })
  const tmp = ROUTING_STATE_PATH + '.tmp'
  await mkdir(dirname(ROUTING_STATE_PATH), { recursive: true })
  await writeFile(tmp, payload, 'utf8')
  await rename(tmp, ROUTING_STATE_PATH)
}

export function apply(ctx, rawConfig = {}) {
  const opts = normalizeConfig(rawConfig)
  const state = createState(loadDailyState())
  state.freeEggProviders = new Set(opts.freeEggProviders)
  const log = makeLogger()
  const gateway = createGateway(opts, log)
  const qoderGateway = opts.qoder ? createQoderGateway(opts, log) : null
  const ledger = createLedger(ctx, log)
  const checkin = createCheckin(opts, gateway, state, log)
  // new-api 渠道优先级（平台优先消耗切换）只在配置了 newApi 时启用；
  // 状态对象挂到 state.routing 上供快照读取，未配置时快照里只有 {enabled:false}。
  const routing = opts.newApi ? createRouting(opts, log) : null
  if (routing) state.routing = routing

  // ---- 会话 → 消耗账号归属 ------------------------------------------------
  // 每个会话单独固定一个「承载账号」：一轮回复结束后按事件时刻就近匹配网关最近请求，
  // 首次匹配后不再改（两个会话并发时不会来回跳；前台会话切换时侧边栏跟着换）。
  const pendingAttribution = new Map()
  let activityTimer = null
  /** 事件时刻与网关请求完成时刻的容差：assistant/message 通常紧跟请求完成。 */
  const ATTRIBUTION_WINDOW_MS = 15_000
  function scheduleActivityRefresh() {
    if (activityTimer !== null) return
    activityTimer = setTimeout(() => {
      activityTimer = null
      refreshActivityAttribution().catch(() => {})
    }, 1500)
    // Node 侧定时器不阻塞进程退出（DSH reload 时也无副作用）
    if (typeof activityTimer.unref === 'function') activityTimer.unref()
  }
  async function refreshActivityAttribution() {
    await Promise.allSettled([
      refresh(true),
      refreshQoderActivity(state, qoderGateway, log, true),
    ])
    attributePendingSessions()
  }
  function attributePendingSessions() {
    if (pendingAttribution.size === 0) return
    const candidates = [...state.activity.workbuddy.values(), ...state.activity.qoder.values()]
    const now = Date.now()
    for (const [sessionId, eventAt] of pendingAttribution) {
      // 已固定的会话保持原账号，避免两个会话并发时来回切
      if (state.activity.bySession.has(sessionId)) continue
      let best = null
      let bestDiff = Infinity
      for (const candidate of candidates) {
        if (!candidate || !candidate.at) continue
        const diff = Math.abs(candidate.at - eventAt)
        if (diff > ATTRIBUTION_WINDOW_MS || diff >= bestDiff) continue
        best = candidate
        bestDiff = diff
      }
      if (!best) continue
      state.activity.bySession.set(sessionId, {
        source: best.source,
        uid: best.uid,
        nickname: best.nickname,
        model: best.model,
        at: best.at,
        pinnedAt: now,
      })
    }
    pendingAttribution.clear()
    // 只保留最近固定的会话，避免 Map 无限增长
    if (state.activity.bySession.size > 200) {
      const ordered = [...state.activity.bySession.entries()]
        .sort((left, right) => (left[1].pinnedAt || 0) - (right[1].pinnedAt || 0))
      for (let i = 0; i < ordered.length - 150; i += 1) state.activity.bySession.delete(ordered[i][0])
    }
  }

  // ---- 当日消耗账本落盘（节流 3 秒） ----------------------------------------
  let dailySaveTimer = null
  function scheduleDailySave() {
    if (dailySaveTimer !== null) return
    dailySaveTimer = setTimeout(() => {
      dailySaveTimer = null
      const daily = state.daily
      saveDailyState(daily)
        .then(() => { if (daily) daily.dirty = false })
        .catch(() => {})
    }, 3000)
    if (typeof dailySaveTimer.unref === 'function') dailySaveTimer.unref()
  }
  ctx.effect(() => () => {
    if (activityTimer !== null) clearTimeout(activityTimer)
    if (dailySaveTimer !== null) clearTimeout(dailySaveTimer)
    activityTimer = null
    dailySaveTimer = null
    pendingAttribution.clear()
  })

  // 会话事件：逐轮累计 token；同时记住最近活跃会话供设置页展示。
  ctx.on('session/event', (session, event) => {
    const id = session && typeof session.id === 'string' ? session.id : ''
    if (!id) return
    // 子代理会话不参与「最近活跃对话」的时间线，只进账本（被问到才展示）。
    if (!session.header || session.header.origin !== 'subagent') state.lastSessionId = id
    ledger.note(id, event)
    if (!event || event.type !== 'assistant/message') return
    // 非 free-egg provider 的请求不经过本地网关，不参与消耗归属
    const source = sourceOfEvent(event)
    if (source.provider && !isFreeEggProvider(state, source.provider)) return
    pendingAttribution.set(id, Date.now())
    scheduleActivityRefresh()
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
    if (qoderGateway) await refreshQoder(state, { qoder: qoderGateway }, opts, log)
    work
      .then(() => {
        if (state.daily && state.daily.dirty) scheduleDailySave()
      })
      .catch(() => {})
    return work
  }

  async function handleSnapshot(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const requestedSessionId = url.searchParams.get('sessionId') || ''
    const sessionId = requestedSessionId || state.lastSessionId || ''
    await refresh(false)
    await refreshQoderActivity(state, qoderGateway, log, false)
    if (routing) {
      try {
        await routing.status(false)
      } catch {
        // 渠道优先级只是附加信息，读取失败不能拖垮快照
      }
    }
    await checkin.maybeAuto(6000)
    if (sessionId) await ledger.ensure(sessionId)
    sendJson(res, 200, buildPayload(state, ledger, opts, sessionId, requestedSessionId))
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
    await refreshQoderActivity(state, qoderGateway, log, true)
    if (routing) await routing.status(true)
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
    await refreshQoder(state, { qoder: qoderGateway }, opts, log)
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

  async function handlePreference(req, res) {
    if ((req.method || '').toUpperCase() !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
      return
    }
    if (!routing) {
      sendJson(res, 200, { ok: false, error: 'new_api_disabled' })
      return
    }
    const url = new URL(req.url || '/', 'http://localhost')
    const result = await routing.apply(url.searchParams.get('mode') || '')
    sendJson(res, 200, result)
  }

  route('/snapshot', handleSnapshot)
  route('/sessions', handleSessions)
  route('/refresh', handleRefresh)
  route('/checkin', handleCheckin)
  route('/qoder/checkin', handleQoderCheckin)
  route('/preference', handlePreference)

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
    freeEggProviders: normalizeProviders(source.freeEggProviders),
    catalogBaseCreditsPer1k: Math.max(0, toNumber(source.catalogBaseCreditsPer1k) || 0),
    // Qoder 反代网关（qoder2api-hub）：null = 未配置不启用
    qoder: normalizeQoder(source.qoder),
    // new-api 管理面（平台优先消耗切换）：null = 未配置不启用
    newApi: normalizeNewApi(source.newApi),
  }
}

function normalizeProviders(raw) {
  const list = Array.isArray(raw) ? raw : DEFAULTS.freeEggProviders
  const providers = list
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean)
  return providers.length > 0 ? [...new Set(providers)] : DEFAULTS.freeEggProviders
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

/**
 * new-api 管理面子配置：只认 baseUrl / userId / token / channels / priorities。
 * 没有 baseUrl 视为未配置（返回 null），功能整体关闭。
 * token 只从配置或文件读，绝不写死在代码里。
 */
function normalizeNewApi(raw) {
  if (!raw || typeof raw !== 'object') return null
  const baseUrl = trimSlash(String(raw.baseUrl || '')).trim()
  if (!baseUrl) return null
  const channels = raw.channels && typeof raw.channels === 'object' ? raw.channels : {}
  const priorities = raw.priorities && typeof raw.priorities === 'object' ? raw.priorities : {}
  // new-api 的 PUT 是 GORM 部分更新，零值字段会被跳过：fallback 至少 1；
  // preferred 必须严格高于 fallback，否则「谁优先」无从判断。
  const preferred = clampInt(priorities.preferred, 2, 1_000_000, 10)
  const fallback = clampInt(priorities.fallback, 1, preferred - 1, Math.min(5, preferred - 1))
  return {
    baseUrl,
    userId: clampInt(raw.userId, 1, 1_000_000, 1),
    accessToken: String(raw.accessToken || '').trim(),
    accessTokenFile: String(raw.accessTokenFile || '').trim(),
    channels: {
      workbuddy: clampInt(channels.workbuddy, 1, 1_000_000, 13),
      qoder: clampInt(channels.qoder, 1, 1_000_000, 12),
    },
    priorities: { preferred, fallback },
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

/**
 * 可选数字：每日预算字段在旧网关 / Qoder best-effort 接口里可能缺失。
 * 缺失时保持 undefined（而不是 0），展示侧才能回落到旧的「今日消耗」口径。
 */
function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

/**
 * 网关时间字段归一：Go 的 time.Time 零值经 omitempty 仍会序列化成
 * "0001-01-01T00:00:00Z"（omitempty 对结构体无效），不能当有效时刻；早于 1970 的
 * 一律视为缺失，让调用侧回落（限流缺 reset_at 时用 until）。非法字符串同样归空。
 */
function normalizeTimestamp(value) {
  if (typeof value !== 'string' || value === '') return ''
  const ms = Date.parse(value)
  return Number.isFinite(ms) && ms > 0 ? value : ''
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
    // 模型目录：每模型带上游积分倍率（"x0.11" / "x0.71 credits"），用于给未实测模型估价。
    models: () => request('/v1/models'),
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
    // 模型目录：公开只读接口，每模型带 price_factor（0 = 免费模型）
    models: async () => {
      const response = await fetch(qoder.baseUrl + '/models', {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`Qoder /models → HTTP ${response.status}`)
      return JSON.parse(text)
    },
    // 实测用量台账（按模型聚合 credit / total_tokens）：面板接口，需 panel token。
    usage: () => request('/usage'),
    // 逐条用量台账（page 1 最新在前）：定位消耗账号 + 统计当天积分都要用。
    recent: (limit = 3, page = 1) =>
      request(`/usage/recent?limit=${encodeURIComponent(limit)}&page=${encodeURIComponent(page)}`, { timeoutMs: 4000 }),
    // 手动签到（设置页按钮用）；调度器每日 09/21 自动跑，这里只是手动补
    checkin: async () => request('/accounts/checkin', { method: 'POST', timeoutMs: 300000 }),
    accounts: () => request('/accounts'),
    // 调度器状态：拿最近/下次签到时间，界面与 WorkBuddy 的签到口径对齐
    scheduler: () => request('/scheduler'),
  }
}

/**
 * Qoder 调度器状态 → 与 WorkBuddy 同形的签到记录（兜底口径）。
 * 网关调度器每日多次巡检签到（默认 09:00/21:00，本机加装了 10:15/10:45 窗口）；
 * 当天跑过即视为「今日已签到」。账号行自带 lastCheckin 时优先用那个。
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

/** Qoder 每日活动奖励窗口的开启时刻（本机本地时间 10:00，活动按 UTC+8 刷新）。 */
const QODER_REWARD_OPEN_HOUR = 10

/**
 * 单个 Qoder 账号的签到状态：面板 /accounts 行自带 lastCheckin（逐账号真实签到时间），
 * 优先用它；行缺失 / 没有该字段时才回落到调度器口径。
 * 旧口径「调度器今天跑过 = 所有账号绿」会把没签到的账号也显示成已签到。
 * 10:00 边界：lastCheckin 只是本地盖章，10:00 前巡检看到的是昨天批次已领，
 * 会盖成今天 09:xx，不代表今天的活动奖励已领，要显示「待领取」而不是绿点。
 */
function qoderAccountCheckin(panelRow, scheduler) {
  const last = panelRow && typeof panelRow.lastCheckin === 'string' ? panelRow.lastCheckin.trim() : ''
  const at = last ? parseGatewayTime(last) : null
  if (!at) return qoderCheckinView(scheduler)
  const checked = dateKey(at) === dateKey()
  const nextAt = scheduler && typeof scheduler.next_run_time === 'string' ? scheduler.next_run_time : ''
  if (!checked) {
    return {
      date: dateKey(at),
      at: at.toISOString(),
      state: 'pending',
      message: '今日尚未签到',
      fresh: false,
      nextAt,
    }
  }
  const now = new Date()
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), QODER_REWARD_OPEN_HOUR)
  if (now.getTime() >= windowStart.getTime() && at.getTime() < windowStart.getTime()) {
    return {
      date: dateKey(at),
      at: at.toISOString(),
      state: 'pending',
      message: '今日奖励待领取（每日 10:00 开放，网关 21:00 自动补领）',
      fresh: false,
      nextAt,
    }
  }
  return {
    date: dateKey(at),
    at: at.toISOString(),
    state: 'checked',
    message: '今日已签到（网关自动）',
    fresh: false,
    nextAt,
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
async function refreshQoder(state, gateway, opts, log) {
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
  // Qoder 目录用于识别免费模型（price_factor=0）与给 paid 模型估价，30 分钟一拉；
  // 实测用量台账 5 分钟一拉，是 Qoder 模型单价的最可靠来源。
  const needModels = !state.models.qoderAt || now - state.models.qoderAt > MODELS_TTL_MS
  const needUsage = !state.usage.qoderAt || now - state.usage.qoderAt > USAGE_TTL_MS
  const work = (async () => {
    try {
      const [summary, scheduler, catalog, usage, panel] = await Promise.all([
        qoder.credits(),
        qoder.scheduler().catch(() => null),
        needModels
          ? qoder.models().catch(error => {
              log('读取 Qoder 模型目录失败', error)
              return null
            })
          : null,
        needUsage
          ? qoder.usage().catch(error => {
              log('读取 Qoder 用量台账失败', error)
              return null
            })
          : null,
        // 每日预算（GET /accounts，面板 token 已封装）：best-effort，失败只让三个
        // 预算字段缺省，不能拖垮整次 Qoder 刷新。
        qoder.accounts().catch(error => {
          log('读取 Qoder 账号列表失败', error)
          return null
        }),
      ])
      if (catalog) {
        state.models.qoder = parseQoderCatalog(catalog)
        state.models.qoderAt = Date.now()
      } else if (needModels) {
        // 失败后 5 分钟再试，避免每轮 Qoder 刷新都重复失败。
        state.models.qoderAt = now - MODELS_TTL_MS + 5 * 60_000
      }
      if (usage) {
        state.usage.qoder = parseQoderUsage(usage)
        state.usage.qoderAt = Date.now()
      } else if (needUsage) {
        // 失败后 2 分钟再试。
        state.usage.qoderAt = now - USAGE_TTL_MS + 2 * 60_000
      }
      if (catalog || usage) buildPrice(state, opts)
      // 每日预算：/accounts 行按 uid 与积分汇总对齐；本次拉取失败时沿用上次成功值，
      // 避免网关抖动让「已用/上限」闪回缺省。
      const panelByUid = new Map()
      for (const row of Array.isArray(panel?.accounts) ? panel.accounts : []) {
        if (row && typeof row.uid === 'string' && row.uid) panelByUid.set(row.uid, row)
      }
      const previousByUid = new Map(
        (cached && Array.isArray(cached.accounts) ? cached.accounts : []).map(account => [account.uid, account]),
      )
      const accounts = (Array.isArray(summary?.accounts) ? summary.accounts : []).map(row => {
        const uid = String(row.uid || '')
        const panelRow = panelByUid.get(uid) || null
        const previous = previousByUid.get(uid) || null
        return {
          uid,
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
          // 签到状态按账号：面板 lastCheckin 优先，缺失时回落调度器口径
          checkin: qoderAccountCheckin(panelRow, scheduler),
          // 每日预算统一字段：本次 /accounts 无该行（或接口失败）时保持上一次的值，
          // 从未拿到过则 undefined/0，展示侧回落旧的「今日消耗」口径。
          dailyCreditSpent: panelRow ? optionalNumber(panelRow.dailyCreditsToday) : previous ? previous.dailyCreditSpent : undefined,
          dailyCreditLimit: panelRow ? toNumber(panelRow.dailyCreditLimit) : previous ? previous.dailyCreditLimit : 0,
          capped: panelRow ? panelRow.creditLimitReached === true : previous ? previous.capped === true : false,
        }
      })
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

/** Qoder 最近用量台账的轮询缓存：3 秒内的重复快照不再打面板。 */
const QODER_ACTIVITY_TTL_MS = 3_000
/** 面板不可用时的退避：别每 3 秒刷一次失败日志。 */
const QODER_ACTIVITY_RETRY_MS = 12_000
/** 一次翻页的台账条数：Host 当天首次启动要翻到昨天为止，补齐已发生的消耗。 */
const QODER_RECENT_PAGE = 100

/** 本地时间当天 0 点（毫秒）。 */
function startOfDayMs() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** 当日消耗账本的初始形状（跨天时整体替换）。 */
function createDailyState() {
  return {
    date: dateKey(),
    workbuddy: new Map(),   // uid → 当日已消耗积分（余额差值累计）
    qoder: new Map(),       // uid → 当日已扣积分（台账 credit 累加；billable=false 的免费调用不计）
    wbCredits: new Map(),   // uid → 上次看到的余额（差值基线）
    qoderLoaded: false,
    qoderSeen: new Set(),
    dirty: false,           // 有变动才落盘
  }
}

/** 跨天时重置「当日消耗」累计；每次刷新都会先调一次。 */
function ensureDaily(state) {
  const today = dateKey()
  if (state.daily && state.daily.date === today) return
  state.daily = createDailyState()
}

/**
 * WorkBuddy 当日消耗：网关每次请求会按上游 credit 扣减账号余额（取整），
 * 这里累加两次快照之间的余额下降量；签到/任务导致的上调只更新基线、不计消耗。
 * 基线/累计会落盘，DSH 重启后能接着算（停机期间的消耗也算进首个差值）。
 */
function accumulateWorkbuddyDaily(state) {
  ensureDaily(state)
  const daily = state.daily
  for (const account of state.accounts) {
    if (!account.uid) continue
    const current = toNumber(account.credits)
    const previous = daily.wbCredits.get(account.uid)
    daily.wbCredits.set(account.uid, current)
    if (previous === undefined || current >= previous) continue
    daily.workbuddy.set(account.uid, (daily.workbuddy.get(account.uid) || 0) + (previous - current))
    daily.dirty = true
  }
}

/**
 * 刷新 Qoder 最近用量：同时维护两件事——
 *   ① 每个账号最近一次请求的候选（按事件时刻就近归属到会话）；
 *   ② 当天每个账号消耗的 credit（/usage/recent 行自带 credit，精确值）。
 * 当天首次（或 Host 刚启动）会往前翻页到昨天为止补齐历史，之后只取最新一页增量。
 */
async function refreshQoderActivity(state, qoderGateway, log, force) {
  if (!qoderGateway || !qoderGateway.enabled) return
  if (!state.qoder || !state.qoder.enabled) return
  // 网关离线时不做无谓的面板请求（refreshQoder 已标记 online=false）
  if (state.qoder.online === false) return
  ensureDaily(state)
  const now = Date.now()
  const fetchedAt = state.activity.qoderFetchedAt || 0
  if (!force) {
    if (fetchedAt && now - fetchedAt < QODER_ACTIVITY_TTL_MS) return
    if (fetchedAt > now) return   // 失败退避期内
  }
  state.activity.qoderFetchedAt = now
  try {
    const dayStart = startOfDayMs()
    const daily = state.daily
    const pages = daily.qoderLoaded ? 1 : 10
    const rows = []
    for (let page = 1; page <= pages; page += 1) {
      const payload = await qoderGateway.recent(QODER_RECENT_PAGE, page)
      const batch = Array.isArray(payload?.rows) ? payload.rows : []
      if (batch.length === 0) break
      rows.push(...batch)
      const oldest = batch[batch.length - 1]
      const oldestAt = oldest && Number(oldest.at) ? Number(oldest.at) * 1000 : 0
      if (oldestAt > 0 && oldestAt < dayStart) break
      if (batch.length < QODER_RECENT_PAGE) break
    }
    daily.qoderLoaded = true
    const knownAccounts = Array.isArray(state.qoder.accounts) ? state.qoder.accounts : []
    for (const row of rows) {
      if (!row || row.error) continue
      const account = typeof row.account === 'string' ? row.account : ''
      const at = Number(row.at)
      if (!account || !Number.isFinite(at) || at <= 0) continue
      const atMs = at * 1000
      if (atMs < dayStart) continue
      // 当天消费精确累加（同一行只算一次）
      const key = account + '|' + at + '|' + (row.total_tokens || 0)
      if (!daily.qoderSeen.has(key)) {
        daily.qoderSeen.add(key)
        // 免费模型（billable=false）只记名义 credit、不扣积分，不能计入今日消耗；
        // 旧网关没有 billable 字段时按计费处理，保持原口径。
        const credit = row.billable === false ? 0 : Number(row.credit)
        if (Number.isFinite(credit) && credit > 0) {
          daily.qoder.set(account, (daily.qoder.get(account) || 0) + credit)
        }
      }
      // 会话归属候选：每个账号保留最近一条请求
      const previous = state.activity.qoder.get(account)
      if (previous && atMs <= previous.at) continue
      const known = knownAccounts.find(item => item.uid === account)
      state.activity.qoder.set(account, {
        at: atMs,
        source: 'qoder',
        uid: account,
        nickname: known ? known.nickname : account.slice(0, 8),
        model: stripRealm(row.model || ''),
      })
    }
    // 去重 Set 只服务于当天；异常大时清空重来（最多多算一页的极端情况可接受）
    if (daily.qoderSeen.size > 50_000) daily.qoderSeen.clear()
  } catch (error) {
    state.activity.qoderFetchedAt = now + QODER_ACTIVITY_RETRY_MS
    log('读取 Qoder 最近用量失败', error)
  }
}

// ---------------------------------------------------------------------------
// new-api 管理面：积分优先消耗平台（渠道优先级）
// ---------------------------------------------------------------------------

/** 渠道优先级状态的缓存时长：页面轮询每 30 秒最多问一次 new-api。 */
const ROUTING_TTL_MS = 30_000

/**
 * new-api 管理 API 客户端。
 * 管理接口要两个头：Authorization: Bearer <access_token> + New-Api-User: <userId>。
 * token 读取策略与 Qoder 面板密码一致：文件优先（mtime 变化重读），inline 兜底；
 * 任何日志都不输出 token 本身。
 */
function createNewApiClient(newApi, log) {
  let tokenCache = ''
  let tokenFileMtime = 0
  let tokenMtimeChecked = false

  async function accessToken() {
    if (newApi.accessTokenFile) {
      try {
        const info = await stat(newApi.accessTokenFile)
        if (tokenCache && tokenMtimeChecked && info.mtimeMs === tokenFileMtime) return tokenCache
        const raw = await readFile(newApi.accessTokenFile, 'utf8')
        const value = raw.trim()
        if (value) {
          tokenCache = value
          tokenFileMtime = info.mtimeMs
          tokenMtimeChecked = true
          return tokenCache
        }
      } catch (error) {
        log('读取 new-api access token 文件失败 ' + newApi.accessTokenFile, error)
      }
    }
    if (!tokenCache) tokenCache = newApi.accessToken
    if (!tokenCache) throw new Error('未配置 new-api access token（accessTokenFile 与 accessToken 均为空）')
    return tokenCache
  }

  async function request(path, options = {}) {
    const { method = 'GET', body } = options
    const token = await accessToken()
    const response = await fetch(newApi.baseUrl + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'new-api-user': String(newApi.userId),
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`new-api ${method} ${path} → HTTP ${response.status}: ${text.slice(0, 160)}`)
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`new-api ${method} ${path} 返回非 JSON: ${text.slice(0, 120)}`)
    }
    if (parsed && parsed.success === false) {
      throw new Error(`new-api ${method} ${path} 失败: ${typeof parsed.message === 'string' ? parsed.message : text.slice(0, 120)}`)
    }
    return parsed
  }

  return {
    channel: async id => {
      const payload = await request(`/api/channel/${encodeURIComponent(id)}`)
      const data = payload && payload.data
      if (!data || typeof data !== 'object') throw new Error(`new-api 渠道 ${id} 返回缺 data`)
      return data
    },
    // 部分更新：只带 id + priority，其他字段由 new-api 沿用（GORM 会跳过零值字段）
    updatePriority: (id, priority) =>
      request('/api/channel/', { method: 'PUT', body: { id, priority } }),
  }
}

/**
 * 积分优先消耗平台：new-api 里 WorkBuddy / Qoder 各一个渠道，优先级数字大的先用，
 * 上游出错重试会落到下一优先级渠道。所以「优先平台」= 自己 preferred、对方 fallback。
 * 状态挂在 state.routing 上被快照读取；读取失败只降级 available，不抛给快照路径。
 */
function createRouting(opts, log) {
  const newApi = opts.newApi
  const client = createNewApiClient(newApi, log)
  const wbId = newApi.channels.workbuddy
  const qoderId = newApi.channels.qoder
  const preferred = newApi.priorities.preferred
  const fallback = newApi.priorities.fallback
  const state = {
    enabled: true,
    available: false,
    mode: loadRoutingMode(),
    actualMode: '',
    matched: false,
    error: '',
    updatedAt: '',
    channels: {
      workbuddy: { id: wbId, priority: null },
      qoder: { id: qoderId, priority: null },
    },
    preferredPriority: preferred,
    fallbackPriority: fallback,
  }
  // 内部字段（不进快照）：缓存时刻 / 进行中的读取 / 进行中的切换
  let checkedAt = 0
  let checking = null
  let applying = null

  function view() {
    return {
      enabled: state.enabled,
      available: state.available,
      mode: state.mode,
      actualMode: state.actualMode,
      matched: state.matched,
      error: state.error,
      updatedAt: state.updatedAt,
      channels: {
        workbuddy: { id: state.channels.workbuddy.id, priority: state.channels.workbuddy.priority },
        qoder: { id: state.channels.qoder.id, priority: state.channels.qoder.priority },
      },
      preferredPriority: state.preferredPriority,
      fallbackPriority: state.fallbackPriority,
    }
  }

  /** GET 两个渠道的 priority 并写回状态；任一失败直接抛给调用方决定怎么降级。 */
  async function readPriorities() {
    const [workbuddy, qoder] = await Promise.all([
      client.channel(wbId),
      client.channel(qoderId),
    ])
    for (const [key, row] of [['workbuddy', workbuddy], ['qoder', qoder]]) {
      const priority = Number(row.priority)
      if (!Number.isFinite(priority)) throw new Error(`new-api 渠道 ${state.channels[key].id} 缺 priority`)
      state.channels[key].priority = priority
    }
    return {
      workbuddy: state.channels.workbuddy.priority,
      qoder: state.channels.qoder.priority,
    }
  }

  function deriveMode(workbuddyPriority, qoderPriority) {
    if (workbuddyPriority > qoderPriority) return 'workbuddy'
    if (workbuddyPriority < qoderPriority) return 'qoder'
    return 'tie'
  }

  /** 只读当前状态：30 秒缓存；不改写优先级。 */
  async function status(force = false) {
    const now = Date.now()
    if (!force && checkedAt && now - checkedAt < ROUTING_TTL_MS) return view()
    if (checking) return checking
    checking = (async () => {
      try {
        const priorities = await readPriorities()
        state.available = true
        state.error = ''
        state.actualMode = deriveMode(priorities.workbuddy, priorities.qoder)
        state.matched = Boolean(state.mode) && state.actualMode === state.mode
        state.updatedAt = new Date().toISOString()
      } catch (error) {
        // new-api 挂了也不能让快照失败：只标记不可用
        state.available = false
        state.actualMode = ''
        state.matched = false
        state.error = errorMessage(error)
        log('读取 new-api 渠道优先级失败', error)
      } finally {
        checkedAt = Date.now()
        checking = null
      }
      return view()
    })()
    return checking
  }

  async function applyMode(mode) {
    const desired = mode === 'workbuddy'
      ? { workbuddy: preferred, qoder: fallback }
      : { workbuddy: fallback, qoder: preferred }
    try {
      // 先读当前值：没变的渠道跳过 PUT（new-api 每次 PUT 都会写库）
      let current = null
      try {
        current = await readPriorities()
      } catch (error) {
        log('读取 new-api 渠道优先级失败（继续写入）', error)
      }
      for (const key of ['workbuddy', 'qoder']) {
        if (current && current[key] === desired[key]) continue
        await client.updatePriority(state.channels[key].id, desired[key])
      }
      // 写完必须 GET 校验：两个渠道都到期望值才算切换成功
      const verified = await readPriorities()
      if (verified.workbuddy !== desired.workbuddy || verified.qoder !== desired.qoder) {
        throw new Error(
          `new-api 渠道优先级校验失败：期望 ${wbId}=${desired.workbuddy}、${qoderId}=${desired.qoder}，`
          + `实际 ${wbId}=${verified.workbuddy}、${qoderId}=${verified.qoder}`,
        )
      }
      state.available = true
      state.error = ''
      state.mode = mode
      state.actualMode = deriveMode(verified.workbuddy, verified.qoder)
      state.matched = state.actualMode === mode
      state.updatedAt = new Date().toISOString()
      checkedAt = Date.now()
      try {
        await saveRoutingMode(mode)
      } catch (error) {
        // 优先级已经切好；落盘失败只影响重启后还记不记得这次选择
        log('保存优先消耗平台失败', error)
      }
      log(`已切换积分优先消耗平台：${mode === 'workbuddy' ? 'WorkBuddy' : 'Qoder'}（${wbId}=${verified.workbuddy}、${qoderId}=${verified.qoder}）`)
      return { ok: true, routing: view() }
    } catch (error) {
      state.available = false
      state.error = errorMessage(error)
      log('切换积分优先消耗平台失败', error)
      // 失败保留原 mode：不把用户期望改写成成功态
      return { ok: false, error: state.error, routing: view() }
    }
  }

  /** 切换优先平台：mode 只接受 workbuddy / qoder；并发时复用同一个 promise。 */
  async function apply(mode) {
    if (mode !== 'workbuddy' && mode !== 'qoder') return { ok: false, error: 'invalid_mode' }
    if (applying) return applying
    applying = (async () => {
      try {
        return await applyMode(mode)
      } finally {
        applying = null
      }
    })()
    return applying
  }

  return { status, apply, view }
}


// ---------------------------------------------------------------------------
// 快照状态
// ---------------------------------------------------------------------------

function createState(persistedDaily) {
  const daily = createDailyState()
  // 恢复当天已累计的 WorkBuddy 消耗与余额基线（Qoder 消耗由网关台账现算，无需落盘）
  if (persistedDaily && persistedDaily.date === daily.date) {
    for (const [uid, value] of Object.entries(persistedDaily.workbuddy || {})) {
      if (!uid) continue
      const number = Number(value)
      if (Number.isFinite(number) && number >= 0) daily.workbuddy.set(uid, number)
    }
    for (const [uid, value] of Object.entries(persistedDaily.balances || {})) {
      if (!uid) continue
      const number = Number(value)
      if (Number.isFinite(number)) daily.wbCredits.set(uid, number)
    }
  }
  return {
    accounts: [],
    pool: null,
    version: '',
    price: {},
    priceDetail: [],
    priceBasis: 'none',
    priceEstimated: 0,
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
    // new-api 平台优先消耗模块（createRouting 的返回值，快照读 view()）；null = 未配置
    routing: null,
    // 会话 → 承载账号：bySession 一旦固定就不再换（前台会话切换只切展示的会话）；
    // workbuddy / qoder 是各账号最近一次请求的候选，用于按事件时刻就近归属。
    activity: { bySession: new Map(), workbuddy: new Map(), qoder: new Map(), qoderFetchedAt: 0 },
    // 当日消耗（本地 0 点起）：WorkBuddy 靠余额差值累计，Qoder 按用量台账精确累加
    daily,
    // 网关模型目录（倍率 / price_factor），用于给未实测模型估价
    models: { workbuddy: [], qoder: [], workbuddyAt: 0, qoderAt: 0, fetching: null },
    // Qoder 实测用量台账（按模型 credit / total_tokens）
    usage: { qoder: [], qoderAt: 0 },
    // 目录倍率的实测校准基线（积分/千 token/倍率单位）
    catalogBase: 0,
    catalogBaseQoder: 0,
    // 单价索引：精确 key → 候选；归一 key → 实测候选（给聚合网关的别名兜底）
    priceIndex: new Map(),
    priceNormalized: new Map(),
    // 哪些 DSH provider 视为 free-egg 模型（不区分大小写）
    freeEggProviders: new Set(),
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
      // 模型目录决定「目录价」能否覆盖未实测模型；失败不影响主快照。
      await refreshWorkbuddyModels(state, gateway, opts, log)
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

/** 网关模型目录的本地缓存时长：网关侧本身缓存 1 小时，这里没必要每轮快照都拉。 */
const MODELS_TTL_MS = 30 * 60_000
/** Qoder 实测用量台账的缓存时长（按模型聚合的 credit/total_tokens 变化很慢）。 */
const USAGE_TTL_MS = 5 * 60_000

/** 解析网关的积分倍率字符串："x0.11" / "x0.71 credits" / "0.06" → 数字。 */
function parseCreditMultiplier(value) {
  if (typeof value !== 'string') return null
  const match = /x?\s*([0-9]+(?:\.[0-9]+)?)/i.exec(value)
  if (!match) return null
  const number = Number(match[1])
  return Number.isFinite(number) ? number : null
}

async function refreshWorkbuddyModels(state, gateway, opts, log) {
  const now = Date.now()
  if (state.models.workbuddyAt && now - state.models.workbuddyAt < MODELS_TTL_MS) return
  if (state.models.fetching) return state.models.fetching
  state.models.fetching = (async () => {
    try {
      const payload = await gateway.models()
      const rows = Array.isArray(payload?.data) ? payload.data : []
      const list = []
      for (const row of rows) {
        const id = row && typeof row.id === 'string' ? row.id : ''
        if (!id) continue
        list.push({ id, multiplier: parseCreditMultiplier(row.credits) })
      }
      state.models.workbuddy = list
      state.models.workbuddyAt = Date.now()
      // 目录到达后重算单价：未实测模型靠倍率折算。
      buildPrice(state, opts)
    } catch (error) {
      log('读取网关模型目录失败', error)
      // 失败后 5 分钟再试，避免每次快照轮询都打网关。
      state.models.workbuddyAt = Date.now() - MODELS_TTL_MS + 5 * 60_000
    } finally {
      state.models.fetching = null
    }
  })()
  return state.models.fetching
}

/** Qoder /usage 的 by_model → [{ model, tokens, credit, requests }]。 */
function parseQoderUsage(payload) {
  const byModel = payload && typeof payload.by_model === 'object' ? payload.by_model : {}
  const list = []
  for (const [model, row] of Object.entries(byModel)) {
    if (!model || !row || typeof row !== 'object') continue
    const tokens = toNumber(row.total_tokens)
    if (!(tokens > 0)) continue
    list.push({
      model,
      tokens,
      credit: toNumber(row.credit),
      requests: toNumber(row.requests),
    })
  }
  return list
}

/** Qoder /models → [{ id, aliases, factor }]；factor 为 0 即免费模型。 */
function parseQoderCatalog(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : []
  const list = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const id = typeof row.id === 'string' ? row.id : ''
    if (!id) continue
    const aliases = Array.isArray(row.aliases)
      ? row.aliases.filter(alias => typeof alias === 'string' && alias)
      : []
    list.push({ id, aliases, factor: toNumber(row.price_factor) })
  }
  return list
}

function applyOverview(state, overview, opts) {
  ensureDaily(state)
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
      lastSuccess: normalizeTimestamp(account.last_success),
      // 模型级限流台账（6004）：每模型一行 until/reset_at，用于展示恢复日期。
      // 两者都过 normalizeTimestamp：网关 Go 侧零值会序列化成 0001-01-01，直接当有效
      // 时间会让客户端解析出负数、徽标回落逻辑失效（重置时间不显示）。
      rateLimitedModels: Array.isArray(account.rate_limited_models)
        ? account.rate_limited_models
            .filter(row => row && row.model)
            .map(row => ({
              model: String(row.model),
              until: normalizeTimestamp(row.until),
              resetAt: normalizeTimestamp(row.reset_at),
              reason: typeof row.reason === 'string' ? row.reason : '',
            }))
        : [],
      // 连败降权截止（零值/已过时由展示侧过滤）
      degradeUntil: normalizeTimestamp(account.degrade_until),
      consecutiveFails: toNumber(account.consecutive_fails),
      // 每日积分预算（网关强制）：旧网关没有这三个字段，缺失时保持 undefined/0，
      // 展示侧据此回落旧的「今日消耗」样式。
      dailyCreditSpent: optionalNumber(account.daily_credit_spent),
      dailyCreditLimit: toNumber(account.daily_credit_limit),
      capped: account.daily_credit_capped === true,
      // 账号最近一次上游请求（面板随每次调用回写）：用于侧边栏「哪个账号在消耗」。
      tokenUsage: {
        lastUsedAt: normalizeTimestamp(account.token_usage?.last_used_at),
        lastModel: typeof account.token_usage?.last_model === 'string' ? account.token_usage.last_model : '',
      },
      modelCosts: Array.isArray(account.model_costs)
        ? account.model_costs
            .filter(row => row && row.model)
            .map(row => ({
              model: String(row.model),
              costPer1k: toNumber(row.cost_per_1k),
              samples: toNumber(row.samples),
              lastSeen: normalizeTimestamp(row.last_seen),
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
  noteWorkbuddyActivity(state)
  buildPrice(state, opts)
  accumulateWorkbuddyDaily(state)
}

/**
 * 记录每个 WorkBuddy 账号最近一次请求（时刻/模型）：token_usage.last_used_at 随每次
 * 调用回写，按会话归属时用「事件时刻最近的候选」匹配。
 */
function noteWorkbuddyActivity(state) {
  for (const account of state.accounts) {
    const usage = account.tokenUsage
    if (!usage || !usage.lastUsedAt) continue
    const at = Date.parse(usage.lastUsedAt)
    if (!Number.isFinite(at) || at <= 0) continue
    const previous = state.activity.workbuddy.get(account.uid)
    if (previous && at <= previous.at) continue
    state.activity.workbuddy.set(account.uid, {
      at,
      source: 'workbuddy',
      uid: account.uid,
      nickname: account.nickname,
      model: stripRealm(usage.lastModel),
    })
  }
}

/**
 * 积分单价分三层，后面的覆盖前面的：
 *   1. 网关实测台账（model_costs 的 EMA × 样本数加权）——真值；
 *   2. 目录倍率折算——没实测过的模型用「实测单价 / 倍率」求本次校准基线，再乘目录倍率
 *      （WorkBuddy /v1/models 的 credits、Qoder /models 的 price_factor；0 = 免费模型）；
 *   3. 配置 creditsPer1k —— 永远最后覆盖。
 */
/**
 * 单价优先级：配置覆盖 > 免费(0) > 实测 > 目录倍率折算。
 * 实测来源有两处：WorkBuddy 的 model_costs 与 Qoder 面板 /usage 的 by_model 台账。
 */
const PRICE_PRIORITY = { config: 5, free: 4, measured: 3, catalog: 1 }

function pricePriority(entry) {
  if (!entry) return 0
  if (entry.source === 'config') return PRICE_PRIORITY.config
  if (entry.free) return PRICE_PRIORITY.free
  if (entry.measured) return PRICE_PRIORITY.measured
  return PRICE_PRIORITY.catalog
}

/** 去掉版本号做归一："deepseek-v4.1-flash" 与 "DeepSeek-Flash" 都变成 "deepseek-flash"。 */
function normalizeModelKey(model) {
  return String(model || '')
    .replace(/^(cn|global):/i, '')
    .toLowerCase()
    .replace(/v?\d+(?:\.\d+)*/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
}

/**
 * 查单价。优先级：配置 > 免费 > 精确实测 > 归一实测（仅 free-egg 聚合模型）> 目录估价。
 * 归一实测是给聚合网关兜底的：free-egg 暴露的 deepseek-v4.1-flash 实际可能由
 * Qoder 的 DeepSeek-Flash 承载，两者名字不同但同一模型。
 */
function resolvePrice(state, model, allowAlias) {
  const key = String(model || '').trim().toLowerCase()
  const exact = key && state.priceIndex instanceof Map ? state.priceIndex.get(key) : null
  if (exact && pricePriority(exact) >= PRICE_PRIORITY.measured) {
    return {
      rate: exact.rate,
      source: exact.source,
      measured: exact.measured === true,
      free: exact.free === true,
    }
  }
  if (allowAlias) {
    const normalized = normalizeModelKey(model)
    const list = normalized && state.priceNormalized instanceof Map ? state.priceNormalized.get(normalized) : null
    if (Array.isArray(list) && list.length > 0) {
      let sum = 0
      for (const entry of list) sum += entry.rate
      return {
        rate: sum / list.length,
        source: list.length === 1 ? list[0].source : 'mixed-measured',
        measured: true,
        free: false,
      }
    }
  }
  if (exact) {
    return {
      rate: exact.rate,
      source: exact.source,
      measured: false,
      free: exact.free === true,
    }
  }
  return null
}

function buildPrice(state, opts) {
  const entries = []
  const pushEntry = entry => {
    if (!entry || !entry.model) return
    const rate = Number(entry.rate)
    if (!Number.isFinite(rate) || rate < 0) return
    entries.push(Object.assign({}, entry, { rate }))
  }

  // 1) WorkBuddy 实测台账：按 (账号, 模型) 实测扣费按样本数加权。
  const wbMeasured = new Map()
  for (const account of state.accounts) {
    for (const row of account.modelCosts) {
      const model = stripRealm(row.model)
      if (!model || !Number.isFinite(row.costPer1k) || row.costPer1k < 0) continue
      const samples = Math.max(1, Math.floor(row.samples) || 1)
      const current = wbMeasured.get(model) || { weighted: 0, samples: 0, rows: [] }
      current.weighted += row.costPer1k * samples
      current.samples += samples
      current.rows.push({
        uid: account.uid,
        name: account.nickname || account.uid.slice(0, 8),
        costPer1k: row.costPer1k,
        samples,
      })
      wbMeasured.set(model, current)
    }
  }
  for (const [model, current] of wbMeasured) {
    if (current.samples <= 0) continue
    pushEntry({
      model,
      rate: current.weighted / current.samples,
      source: 'gateway',
      measured: true,
      samples: current.samples,
      accounts: current.rows,
      canonical: true,
    })
  }

  // 2) Qoder 实测台账：/usage 的 by_model（credit ÷ total_tokens）。
  //    缓存命中的输入 token 计费远低于未命中，所以必须用「真实扣费 ÷ 真实 token」，
  //    不能拿 token 总量乘目录倍率硬算（会高估数倍）。
  const qoderMeasured = new Map()
  for (const row of state.usage.qoder) {
    const model = stripRealm(row.model)
    const tokens = toNumber(row.tokens)
    const credit = toNumber(row.credit)
    if (!model || tokens < 5000 || !(credit > 0)) continue
    qoderMeasured.set(model.toLowerCase(), {
      model,
      rate: (credit / tokens) * 1000,
      tokens,
      credit,
    })
  }
  for (const item of qoderMeasured.values()) {
    pushEntry({
      model: item.model,
      rate: item.rate,
      source: 'qoder-usage',
      measured: true,
      tokens: item.tokens,
      canonical: true,
    })
  }
  for (const row of state.models.qoder) {
    const id = stripRealm(row.id)
    const item = qoderMeasured.get(id.toLowerCase())
    if (!item) continue
    for (const key of row.aliases) {
      const alias = stripRealm(key)
      if (!alias || alias.toLowerCase() === id.toLowerCase()) continue
      pushEntry({ model: alias, rate: item.rate, source: 'qoder-usage', measured: true, canonical: false })
    }
  }

  // 3) 目录：每个上游模型一组键（canonical + aliases），倍率/price_factor 用来估价。
  const catalogEntries = []
  const seenCatalog = new Set()
  const addCatalogEntry = (gateway, keys, factor) => {
    const stripped = []
    for (const key of keys) {
      const model = stripRealm(key)
      if (model && !stripped.includes(model)) stripped.push(model)
    }
    if (stripped.length === 0) return
    const id = stripped[0].toLowerCase()
    if (seenCatalog.has(id)) return
    seenCatalog.add(id)
    catalogEntries.push({ gateway, keys: stripped, factor })
  }
  for (const row of state.models.workbuddy) {
    if (row.multiplier === null || row.multiplier === undefined) continue
    addCatalogEntry('workbuddy', [row.id], row.multiplier)
  }
  for (const row of state.models.qoder) {
    addCatalogEntry('qoder', [row.id, ...row.aliases], row.factor)
  }

  const catalogFactorOf = (gateway, model) => {
    const lower = String(model || '').toLowerCase()
    for (const entry of catalogEntries) {
      if (entry.gateway !== gateway) continue
      for (const key of entry.keys) {
        if (key.toLowerCase() === lower) return entry.factor
      }
    }
    return null
  }

  // 4) 两台网关各自的校准基线（积分/千 token/倍率单位），不要跨网关混用。
  let wbCost = 0
  let wbFactor = 0
  for (const [model, current] of wbMeasured) {
    const factor = catalogFactorOf('workbuddy', model)
    if (!(factor > 0)) continue
    wbCost += current.weighted
    wbFactor += factor * current.samples
  }
  const wbBase = wbFactor > 0 ? wbCost / wbFactor : toNumber(opts.catalogBaseCreditsPer1k)
  state.catalogBase = Number.isFinite(wbBase) && wbBase > 0 ? wbBase : 0

  let qoderCost = 0
  let qoderFactor = 0
  for (const item of qoderMeasured.values()) {
    const factor = catalogFactorOf('qoder', item.model)
    if (!(factor > 0)) continue
    qoderCost += item.rate * item.tokens
    qoderFactor += factor * item.tokens
  }
  const qoderBase = qoderFactor > 0 ? qoderCost / qoderFactor : 0
  state.catalogBaseQoder = Number.isFinite(qoderBase) && qoderBase > 0 ? qoderBase : 0

  // 5) 目录估价 + 免费模型（倍率 0 是确定值，不是估算）。
  const seenCatalogKeys = new Set()
  const freeModels = new Set()
  for (const entry of catalogEntries) {
    const factor = entry.factor
    if (!Number.isFinite(factor) || factor < 0) continue
    const base = entry.gateway === 'qoder' ? state.catalogBaseQoder : state.catalogBase
    const isFree = factor === 0
    const rate = isFree ? 0 : base > 0 ? Math.round(factor * base * 1e6) / 1e6 : null
    if (rate === null) continue
    entry.keys.forEach((model, index) => {
      const key = model.toLowerCase()
      if (isFree) freeModels.add(key)
      if (seenCatalogKeys.has(key)) return
      seenCatalogKeys.add(key)
      pushEntry({
        model,
        rate,
        source: 'catalog',
        measured: false,
        free: isFree,
        canonical: index === 0,
      })
    })
  }

  // 6) 配置覆盖优先级最高。
  let overridden = false
  for (const [rawModel, rawValue] of Object.entries(opts.creditsPer1k || {})) {
    const model = stripRealm(rawModel)
    const rate = Number(rawValue)
    if (!model || !Number.isFinite(rate) || rate < 0) continue
    pushEntry({ model, rate, source: 'config', measured: false, canonical: true })
    overridden = true
  }

  // 7) 建索引：精确 key 取最高优先级；归一 key 收集实测候选（给聚合别名兜底）。
  const index = new Map()
  const normalized = new Map()
  for (const entry of entries) {
    const key = entry.model.toLowerCase()
    const current = index.get(key)
    if (!current || pricePriority(entry) > pricePriority(current)) index.set(key, entry)
    if (entry.measured && !entry.free && !freeModels.has(key)) {
      const normalizedKey = normalizeModelKey(entry.model)
      if (!normalizedKey) continue
      const list = normalized.get(normalizedKey) || []
      list.push(entry)
      normalized.set(normalizedKey, list)
    }
  }
  state.priceIndex = index
  state.priceNormalized = normalized

  const price = {}
  for (const [key, entry] of index) price[key] = entry.rate
  state.price = price

  // 8) 明细：每个上游 canonical 模型一行，单价按实际会用的解析结果展示。
  const canonical = new Map()
  for (const entry of entries) {
    if (!entry.canonical) continue
    const key = entry.model.toLowerCase()
    if (!canonical.has(key)) canonical.set(key, entry.model)
  }
  const detail = []
  for (const [key, model] of canonical) {
    const resolved = resolvePrice(state, model, true)
    if (!resolved) continue
    const best = index.get(key)
    detail.push({
      model,
      costPer1k: Math.round(resolved.rate * 1e6) / 1e6,
      samples: best && best.samples ? best.samples : 0,
      accounts: best && best.accounts ? best.accounts : [],
      source: resolved.source,
      measured: resolved.measured === true,
      estimated: !resolved.measured && !resolved.free && resolved.source !== 'config',
    })
  }
  const estimated = detail.filter(row => row.estimated === true).length
  const measuredCount = detail.filter(row => row.measured === true).length
  state.priceDetail = detail.sort((left, right) => left.model.localeCompare(right.model))
  state.priceBasis = overridden
    ? 'config'
    : measuredCount > 0
      ? estimated > 0 ? 'gateway+catalog' : 'gateway'
      : detail.length > 0 ? 'catalog' : 'none'
  state.priceEstimated = estimated
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

/** 助手消息里的 provider + model：provider 决定这条对话算不算 free-egg 模型。 */
function sourceOfEvent(event) {
  const source = event?.data?.message?.source
  if (!source || typeof source !== 'object') return { provider: '', model: '' }
  return {
    provider: typeof source.provider === 'string' ? source.provider : '',
    model: typeof source.model === 'string' ? source.model : '',
  }
}

/** 模型选择 / 请求头事件里的「当前 provider + model」，用于还没出第一轮回复时判断来源。 */
function selectionOfEvent(event) {
  const data = event?.data
  if (event?.type === 'model/selection') {
    return {
      provider: typeof data?.provider === 'string' ? data.provider : '',
      model: typeof data?.model === 'string' ? data.model : '',
    }
  }
  if (event?.type === 'request/header') {
    const config = data?.header?.config
    return {
      provider: typeof config?.provider === 'string' ? config.provider : '',
      model: typeof config?.model === 'string' ? config.model : '',
    }
  }
  return null
}

function createLedger(ctx, log) {
  const sessions = new Map()

  function entry(id) {
    let current = sessions.get(id)
    if (!current) {
      current = {
        turns: new Map(),
        loaded: false,
        loading: null,
        selection: { provider: '', model: '' },
        providers: new Set(),
      }
      sessions.set(id, current)
    }
    return current
  }

  function accumulate(target, turn, tokens, provider, model) {
    const current = target.get(turn) || { tokens: 0, models: new Set(), providers: new Set() }
    current.tokens += tokens
    if (provider) current.providers.add(provider)
    if (model) current.models.add(model)
    target.set(turn, current)
  }

  function note(sessionId, event) {
    if (!event) return
    const current = entry(sessionId)
    const selection = selectionOfEvent(event)
    if (selection) {
      if (selection.provider) current.providers.add(selection.provider)
      if (selection.provider || selection.model) current.selection = selection
      return
    }
    if (event.type !== 'assistant/message') return
    const data = event.data || {}
    const tokens = usageTokens(data.usage)
    const turn = Number(data.turn)
    if (tokens <= 0 || !Number.isFinite(turn)) return
    const source = sourceOfEvent(event)
    if (source.provider) current.providers.add(source.provider)
    accumulate(current.turns, turn, tokens, source.provider, source.model)
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
      const providers = new Set()
      const selection = { provider: '', model: '' }
      for (const event of events) {
        if (!event) continue
        const picked = selectionOfEvent(event)
        if (picked) {
          if (picked.provider) providers.add(picked.provider)
          if (picked.provider || picked.model) {
            selection.provider = picked.provider || selection.provider
            selection.model = picked.model || selection.model
          }
          continue
        }
        if (event.type !== 'assistant/message') continue
        const data = event.data || {}
        const tokens = usageTokens(data.usage)
        const turn = Number(data.turn)
        if (tokens <= 0 || !Number.isFinite(turn)) continue
        const source = sourceOfEvent(event)
        if (source.provider) providers.add(source.provider)
        accumulate(folded, turn, tokens, source.provider, source.model)
      }
      // 日志折叠是权威全集；读取期间新到的实时轮次保留下来。
      for (const [turn, data] of current.turns) {
        if (!folded.has(turn)) folded.set(turn, data)
        for (const provider of data.providers || []) providers.add(provider)
      }
      for (const provider of current.providers) providers.add(provider)
      current.turns = folded
      current.providers = providers
      // 读取期间实时事件更新过的选择优先，只有日志里更明确的 provider 才补进来。
      if (!current.selection.provider && selection.provider) current.selection = selection
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

/** 这个 provider 是否算 free-egg 模型（不区分大小写）。 */
function isFreeEggProvider(state, provider) {
  const name = String(provider || '').trim().toLowerCase()
  if (!name) return false
  return state.freeEggProviders instanceof Set && state.freeEggProviders.has(name)
}

/**
 * 折算一轮积分。providers 为空表示来源未知（旧数据）→ 按模型名尽量折算；
 * 有 provider 但不是 free-egg → 不计积分（返回 null）。
 * free-egg provider 的模型可能是聚合别名，允许用「归一实测」兜底。
 */
function estimateCredits(state, tokens, models, providers) {
  if (!tokens || tokens <= 0) return 0
  const list = providers ? [...providers] : []
  const allowAlias = list.length === 0 || list.some(provider => isFreeEggProvider(state, provider))
  if (list.length > 0 && !allowAlias) return null
  const prices = []
  for (const model of models || []) {
    const resolved = resolvePrice(state, model, allowAlias)
    if (resolved) prices.push(resolved.rate)
  }
  if (prices.length === 0) return null
  const per1k = prices.reduce((sum, value) => sum + value, 0) / prices.length
  return round2((tokens * per1k) / 1000)
}

function sessionView(state, ledger, sessionId) {
  const id = String(sessionId || '')
  const blank = {
    turns: [],
    totalTokens: 0,
    totalCredits: 0,
    pricedTurns: 0,
    known: false,
    loaded: false,
    missingPrice: false,
    providers: [],
    currentProvider: '',
    currentModel: '',
    freeEgg: false,
  }
  if (!id) return { id: '', ...blank }
  const current = ledger.peek(id)
  if (!current) return { id, ...blank }

  const turns = []
  let totalTokens = 0
  let totalCredits = 0
  let pricedTurns = 0
  let missingPrice = false
  for (const [turn, data] of [...current.turns.entries()].sort((left, right) => left[0] - right[0])) {
    const models = [...data.models]
    const providers = [...(data.providers || [])]
    const credits = estimateCredits(state, data.tokens, models, providers)
    if (credits === null) missingPrice = true
    else {
      totalCredits += credits
      pricedTurns += 1
    }
    totalTokens += data.tokens
    turns.push({ turn, tokens: data.tokens, models, providers, credits })
  }

  const providers = new Set(current.providers || [])
  for (const data of current.turns.values()) {
    for (const provider of data.providers || []) providers.add(provider)
  }
  const currentProvider = current.selection && current.selection.provider ? current.selection.provider : ''
  const currentModel = current.selection && current.selection.model ? current.selection.model : ''
  // 「是不是 free-egg 模型」只看 provider：当前选中的或这轮对话里用过的任意一个。
  const freeEgg = Boolean(
    (currentProvider && isFreeEggProvider(state, currentProvider)) ||
      [...providers].some(provider => isFreeEggProvider(state, provider)),
  )

  return {
    id,
    turns,
    totalTokens,
    totalCredits: round2(totalCredits),
    pricedTurns,
    known: current.loaded || current.turns.size > 0,
    loaded: current.loaded,
    missingPrice,
    providers: [...providers],
    currentProvider,
    currentModel,
    freeEgg,
  }
}

/**
 * 侧边栏「这个会话由哪个账号承载」：只看前台会话自己固定到的账号，
 * 不跟随全局最近一次请求（两个会话并发时不会来回跳）。
 * 归属在每轮回复结束后固定；账号被删/不存在时不再高亮。
 */
function activityView(state, sessionId) {
  if (!sessionId) return null
  const record = state.activity.bySession.get(sessionId)
  if (!record) return null
  const exists =
    state.accounts.some(account => account.uid === record.uid) ||
    ((state.qoder && state.qoder.accounts) || []).some(account => account.uid === record.uid)
  if (!exists) return null
  return {
    source: record.source,
    uid: record.uid,
    nickname: record.nickname || '',
    model: record.model || '',
    at: new Date(record.at).toISOString(),
    active: true,
  }
}

function buildPayload(state, ledger, opts, sessionId, activitySessionId) {
  ensureDaily(state)
  const accounts = state.accounts.map(account => ({
    uid: account.uid,
    nickname: account.nickname,
    realm: account.realm,
    credits: account.credits,
    creditsTotal: account.creditsTotal,
    todayCredits: round2(state.daily.workbuddy.get(account.uid) || 0),
    // 每日预算（网关强制）：旧网关没有这三个字段 → undefined/0/false，客户端回落旧样式。
    dailyCreditSpent: account.dailyCreditSpent,
    dailyCreditLimit: account.dailyCreditLimit,
    capped: account.capped === true,
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
          todayCredits: round2(state.daily.qoder.get(account.uid) || 0),
          // 网关 /accounts 的 dailyCreditsToday 是名义口径（免费调用也累计 credit），
          // 用已按 billable 过滤的本地台账替代；台账尚未加载完时回落到网关值。
          dailyCreditSpent: state.daily.qoderLoaded
            ? round2(state.daily.qoder.get(account.uid) || 0)
            : account.dailyCreditSpent,
          dailyCreditLimit: account.dailyCreditLimit,
          capped: account.capped === true,
          cooling: account.cooling,
          disabled: account.disabled,
          lastSuccess: account.lastSuccess,
          checkin: account.checkin || null,
        })),
      }
    : { enabled: false }
  const session = sessionView(state, ledger, sessionId)
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
      priceEstimated: state.priceEstimated || 0,
      catalogBase: state.catalogBase || 0,
      catalogBaseQoder: state.catalogBaseQoder || 0,
      freeEggProviders: [...(state.freeEggProviders || [])],
      autoCheckin: opts.autoCheckin,
    },
    qoder,
    // 平台优先消耗（new-api 渠道优先级）：未配置时只有 {enabled:false}
    routing: state.routing ? state.routing.view() : { enabled: false },
    session,
    activity: activityView(state, activitySessionId),
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
