/**
 * WorkBuddy 积分插件 Client 半（浏览器）。
 *
 * 三个落点，都沿用宿主既有样式，不新增卡片/浮层：
 *   - conversation.composer.dock：输入框下方的迷你状态条（两个账号积分 + 签到点 + 本会话积分）；
 *   - conversation.chat.turnTail：每轮对话结束后的「本轮 ≈N 积分」小字；
 *   - settings.section：详情页（账号、签到、单价、最近对话、逐轮明细）。
 * 数据全部由 Host 半的同源路由 /__dsh-wb-credits/* 提供。
 */
window.__ModuleLoader__.load({
  id: 'dsh-free-egg-credits',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'free-egg-credits'
    const API = '/__dsh-wb-credits'
    // 快照轮询：侧边栏要「实时」显示哪个账号在消耗，5 秒内能跟上每轮对话；
    // 页面隐藏时跳过（服务端刷新本身按 refreshSeconds 节流）。
    const POLL_MS = 5_000

    // -----------------------------------------------------------------------
    // 文案（不依赖 Host 的语言包，索引键相同；缺 t 时直接回落中文）
    // -----------------------------------------------------------------------

    const ZH = {
      'section.title': 'Free Egg 积分',
      'section.desc': 'DeepSeek / Qwen 各上游账号的可用积分、每日签到状态，以及每条对话消耗的积分。',
      'sidebar.title': 'Free Egg 积分',
      'sidebar.today': '今日消耗',
      'sidebar.todayTitle': '今日已消耗 ≈{credits} 积分（本地时间 0 点起）',
      'dock.label': 'Free Egg',
      'dock.loading': 'WorkBuddy 积分读取中…',
      'dock.error': 'WorkBuddy 网关未连接',
      'dock.session': '本会话 ≈{credits} 积分',
      'dock.pending': '本会话 · 等待单价',
      'dock.checkin': '签到 {checked}/{total}',
      'dock.refresh': '刷新',
      'checkin.checked': '今日已签到',
      'checkin.fresh': '今日已签到（本次补签）',
      'checkin.failed': '签到失败：{message}',
      'checkin.unknown': '今日签到状态未知',
      'checkin.pending': '今日尚未签到',
      // 积分优先消耗（平台级）：切换 new-api 渠道优先级，决定 DeepSeek 请求先走哪个平台
      'routing.title': '积分优先消耗',
      'routing.desc': '决定 DeepSeek 请求优先消耗哪个平台的积分，另一个平台作为故障回退。Qoder 服务器拥堵时可切回 WorkBuddy。',
      'routing.workbuddy': 'WorkBuddy 优先',
      'routing.qoder': 'Qoder 优先',
      'routing.actual.workbuddy': 'WorkBuddy 优先',
      'routing.actual.qoder': 'Qoder 优先',
      'routing.actual.tie': '两个渠道同级',
      'routing.actual.none': '未知',
      'routing.current': '当前实际：{actual}（WB 渠道 {wb} · Qoder 渠道 {qoder}）',
      'routing.mismatch': '已选择「{mode}」，但实际优先级是「{actual}」，可能被其他进程改过。',
      'routing.unavailable': '无法读取 new-api 渠道优先级：{message}',
      'routing.applying': '切换中…',
      'routing.failed': '切换失败：{message}',
      'routing.hint': '优先平台 = 提高该平台在 new-api 里的渠道优先级；拥堵或报错时新请求会自动回退到另一平台。切换即时生效，只影响新请求。',
      'routing.sidebar.short.workbuddy': 'WB 优先',
      'routing.sidebar.short.qoder': 'Qoder 优先',
      'routing.sidebar.switchTo': '消耗优先级：{actual}（点击切换为「{next}」优先）',
      'routing.sidebar.applyFailed': '切换失败：{message}',
      'turn.credits': '本轮 ≈{credits} 积分',
      'turn.free': '本轮未计积分',
      'turn.title': '本轮 {tokens} tokens · {models}',
      'settings.gateway': '网关',
      'settings.updated': '更新于',
      'settings.refresh': '刷新',
      'settings.accounts': '账号',
      'settings.price': '折算单价',
      'settings.priceGateway': '按网关实测扣费台账加权 · {count} 个模型',
      'settings.priceMixed': '网关实测 + 按模型倍率折算 · {count} 个模型',
      'settings.priceCatalog': '按模型倍率折算（以实测单价为基线） · {count} 个模型',
      'settings.priceConfig': '在插件配置里覆盖',
      'settings.priceNone': '暂无实测单价，暂时只显示 token',
      'settings.estimated': '估算',
      'settings.priceEstimatedCount': '{count} 个模型按倍率估算',
      'settings.priceFreeCount': '{count} 个模型免费',
      'settings.recent': '最近对话',
      'settings.current': '当前对话逐轮明细',
      'settings.turn': '轮次',
      'settings.tokens': 'tokens',
      'settings.credits': '≈积分',
      'settings.usage': '已用 {used} / 总 {total}',
      'settings.today': '今日消耗 ≈{credits} 积分',
      'settings.models': '模型',
      'settings.time': '时间',
      'settings.empty': '暂无数据',
      'settings.checkin': '立即签到',
      'settings.checking': '签到中…',
      'settings.total': '总额度 {total}',
      'settings.lastSuccess': '最近成功 {time}',
      'settings.hint': '积分按「网关实测单价」或「模型倍率折算」估算，上游限免时段实际扣费可能更低；签到状态来自一次幂等的签到调用。',
      'settings.noticeFailed': '操作失败：{message}',
      'limit.flag': '限流',
      'limit.degrade': '降权',
      'limit.streak': '连败',
      'limit.title': '限流中：{model}',
      'limit.reset': '重置 {time}',
      'limit.cooldown': '本地冷却到 {time}',
      'limit.degradeTitle': '连续失败降权中（{fails} 连败）',
      'limit.degradeRecover': '解除 {time}',
      'limit.failStreak': '连续失败 {fails} 次',
      'limit.section': '限流状态',
      'limit.none': '无模型级限流',
      'limit.banned': '已被上游封禁：{reason}',
      'qoder.title': 'Qoder 积分',
      'qoder.offline': 'Qoder 网关未连接',
      'qoder.checked': 'Qoder 已签到',
      'qoder.pending': 'Qoder 待签到',
      'qoder.checkin': '立即签到',
      'qoder.checking': '签到中…',
      'qoder.checkinOk': '已签到 {nickname}',
      'qoder.checkinFail': '签到失败：{message}',
      'qoder.used': '已用 {used} / {total}',
      // 每日积分预算（网关强制，插件只读展示）
      'budget.todayTitle': '今日已用 ≈{used} / 上限 {limit}（剩余 ≈{remaining}，本地时间 0 点起）',
      'budget.cappedTip': '今日已满额，已停用，明日 0 点恢复',
      'budget.aria': '今日已用 / 上限',
      'budget.allCapped': '今日额度已用完：DeepSeek 已自动降级到 Qwen3.8-Flash（免费）',
      'settings.todayBudget': '今日已用 ≈{used} / {limit}（剩余 ≈{remaining}）',
      'settings.capped': '今日已满额，账号已停用，明日 0 点恢复',
    }

    const EN = {
      'section.title': 'Free Tier Credits',
      'section.desc': 'Credits and daily check-in state across DeepSeek / Qwen upstream accounts, plus credits per conversation.',
      'sidebar.title': 'Free Tier Credits',
      'sidebar.today': 'Today',
      'sidebar.todayTitle': '≈{credits} credits used today (since local midnight)',
      'dock.label': 'Free Egg',
      'dock.loading': 'Reading WorkBuddy credits…',
      'dock.error': 'WorkBuddy gateway unreachable',
      'dock.session': 'This chat ≈{credits} credits',
      'dock.pending': 'This chat · rate pending',
      'dock.checkin': 'Check-in {checked}/{total}',
      'dock.refresh': 'Refresh',
      'checkin.checked': 'Checked in today',
      'checkin.fresh': 'Checked in just now',
      'checkin.failed': 'Check-in failed: {message}',
      'checkin.unknown': 'Check-in state unknown',
      'checkin.pending': 'Not checked in yet today',
      // Credit priority (platform level): flips new-api channel priorities, i.e. which platform serves DeepSeek first
      'routing.title': 'Credit priority',
      'routing.desc': 'Choose which platform’s credits DeepSeek requests spend first; the other platform stays as failover. Switch back to WorkBuddy when Qoder is congested.',
      'routing.workbuddy': 'Prefer WorkBuddy',
      'routing.qoder': 'Prefer Qoder',
      'routing.actual.workbuddy': 'WorkBuddy first',
      'routing.actual.qoder': 'Qoder first',
      'routing.actual.tie': 'Both channels tied',
      'routing.actual.none': 'Unknown',
      'routing.current': 'Effective now: {actual} (WB channel {wb} · Qoder channel {qoder})',
      'routing.mismatch': 'Selected “{mode}” but the effective priority is “{actual}” — another process may have changed it.',
      'routing.unavailable': 'Cannot read new-api channel priorities: {message}',
      'routing.applying': 'Switching…',
      'routing.failed': 'Switch failed: {message}',
      'routing.hint': 'Preferred platform = higher new-api channel priority; if it is congested or failing, new requests fall back to the other platform. Applies to new requests only.',
      'routing.sidebar.short.workbuddy': 'WB first',
      'routing.sidebar.short.qoder': 'Qoder first',
      'routing.sidebar.switchTo': 'Credit priority: {actual} (click to prefer {next})',
      'routing.sidebar.applyFailed': 'Switch failed: {message}',
      'turn.credits': 'This turn ≈{credits} credits',
      'turn.free': 'This turn cost no credits',
      'turn.title': 'This turn {tokens} tokens · {models}',
      'settings.gateway': 'Gateway',
      'settings.updated': 'Updated',
      'settings.refresh': 'Refresh',
      'settings.accounts': 'Accounts',
      'settings.price': 'Credit rate',
      'settings.priceGateway': 'Weighted from the gateway charge ledger · {count} models',
      'settings.priceMixed': 'Measured + estimated from model multipliers · {count} models',
      'settings.priceCatalog': 'Estimated from model multipliers (calibrated by measured rates) · {count} models',
      'settings.priceConfig': 'Overridden in plugin config',
      'settings.priceNone': 'No measured rate yet — only tokens are shown',
      'settings.estimated': 'est.',
      'settings.priceEstimatedCount': '{count} models estimated from multipliers',
      'settings.priceFreeCount': '{count} free models',
      'settings.recent': 'Recent chats',
      'settings.current': 'Credits per turn in this chat',
      'settings.turn': 'Turn',
      'settings.tokens': 'Tokens',
      'settings.credits': '≈Credits',
      'settings.usage': 'Used {used} / {total}',
      'settings.today': '≈{credits} credits used today',
      'settings.models': 'Model',
      'settings.time': 'Time',
      'settings.empty': 'No data yet',
      'settings.checkin': 'Check in now',
      'settings.checking': 'Checking in…',
      'settings.total': 'Total quota {total}',
      'settings.lastSuccess': 'Last success {time}',
      'settings.hint': 'Credits are estimated from measured gateway charge rates or model multipliers; actual charges during upstream free periods can be lower. Check-in state comes from one idempotent check-in call.',
      'settings.noticeFailed': 'Operation failed: {message}',
      'limit.flag': 'Limited',
      'limit.degrade': 'Degraded',
      'limit.streak': 'Failing',
      'limit.title': 'Rate limited: {model}',
      'limit.reset': 'Resets {time}',
      'limit.cooldown': 'Local cooldown until {time}',
      'limit.degradeTitle': 'Degraded after {fails} consecutive failures',
      'limit.degradeRecover': 'Lifts {time}',
      'limit.failStreak': '{fails} consecutive failures',
      'limit.section': 'Rate limit state',
      'limit.none': 'No model-level rate limit',
      'limit.banned': 'Banned by upstream: {reason}',
      'qoder.title': 'Qoder Credits',
      'qoder.offline': 'Qoder gateway unreachable',
      'qoder.checked': 'Qoder checked in',
      'qoder.pending': 'Qoder not checked in',
      'qoder.checkin': 'Check in now',
      'qoder.checking': 'Checking in…',
      'qoder.checkinOk': 'Checked in {nickname}',
      'qoder.checkinFail': 'Check-in failed: {message}',
      'qoder.used': 'Used {used} / {total}',
      // Daily credit budget (enforced by the gateways; this plugin only displays it)
      'budget.todayTitle': '≈{used} of {limit} credits used today (≈{remaining} left, since local midnight)',
      'budget.cappedTip': 'Daily limit reached — account paused, resets at 00:00',
      'budget.aria': 'Used / daily limit',
      'budget.allCapped': 'Daily credits used up: DeepSeek falls back to Qwen3.8-Flash (free) automatically',
      'settings.todayBudget': '≈{used} of {limit} credits used today (≈{remaining} left)',
      'settings.capped': 'Daily limit reached — account paused, resets at 00:00',
    }

    let boundTranslate = null

    function translateWith(t, key, fallback, vars) {
      let text = fallback
      if (typeof t === 'function') {
        try {
          const value = t(key)
          if (typeof value === 'string' && value !== key) text = value
        } catch {
          // 语言包缺失时用回落文案
        }
      } else if (typeof boundTranslate === 'function') {
        try {
          const value = boundTranslate(key)
          if (typeof value === 'string' && value !== key) text = value
        } catch {
          // 同上
        }
      }
      if (vars) {
        for (const name of Object.keys(vars)) {
          text = text.split('{' + name + '}').join(String(vars[name]))
        }
      }
      return text
    }

    // -----------------------------------------------------------------------
    // 数据仓库：同一页面内所有落点共享一份快照
    // -----------------------------------------------------------------------

    function createStore() {
      const listeners = new Set()
      let current = { data: null, error: '', loading: false, sessionId: '', fetchedAt: 0 }
      let inflight = null
      let timer = null
      let soonTimer = null

      function emit(patch) {
        current = Object.assign({}, current, patch)
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            console.error('[free-egg-credits] listener failed', error)
          }
        }
      }

      function load() {
        if (inflight) return inflight
        const query = current.sessionId ? '?sessionId=' + encodeURIComponent(current.sessionId) : ''
        inflight = (async () => {
          emit({ loading: true })
          try {
            const response = await fetch(API + '/snapshot' + query, { cache: 'no-store' })
            const text = await response.text()
            if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 160))
            const data = JSON.parse(text)
            emit({ data, error: '', loading: false, fetchedAt: Date.now() })
          } catch (error) {
            emit({ error: error && error.message ? error.message : String(error), loading: false })
          } finally {
            inflight = null
          }
        })()
        return inflight
      }

      /** 短延迟触发一次拉取：对应「某一轮刚结束，账本应该已经有数据了」。 */
      function loadSoon(delayMs) {
        if (soonTimer) return
        soonTimer = setTimeout(() => {
          soonTimer = null
          load()
        }, typeof delayMs === 'number' ? delayMs : 800)
      }

      function startPolling() {
        if (timer) return
        timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          load()
        }, POLL_MS)
      }

      function stopPolling() {
        if (!timer) return
        clearInterval(timer)
        timer = null
      }

      function subscribe(listener) {
        listeners.add(listener)
        startPolling()
        load()
        return () => {
          listeners.delete(listener)
          if (listeners.size === 0) stopPolling()
        }
      }

      function setSession(sessionId) {
        const id = typeof sessionId === 'string' ? sessionId : ''
        if (!id || id === current.sessionId) return
        current = Object.assign({}, current, { sessionId: id })
        load()
      }

      return {
        subscribe,
        setSession,
        load,
        loadSoon,
        refresh: () => load(),
        getState: () => current,
      }
    }

    const store = createStore()

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') store.load()
      })
    }

    function useStore() {
      const [snapshot, setSnapshot] = React.useState(store.getState())
      React.useEffect(() => {
        let alive = true
        const off = store.subscribe(() => {
          if (alive) setSnapshot(store.getState())
        })
        return () => {
          alive = false
          off()
        }
      }, [])
      return snapshot
    }

    function useSessionStore(sessionId) {
      React.useEffect(() => {
        if (sessionId) store.setSession(sessionId)
      }, [sessionId])
      return useStore()
    }

    // -----------------------------------------------------------------------
    // 格式化
    // -----------------------------------------------------------------------

    function trimModel(model) {
      return String(model || '').replace(/^(cn|global):/i, '')
    }

    function formatBalance(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      return number.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
    }

    function formatCredits(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      if (Math.abs(number) >= 100) return number.toFixed(0)
      if (Math.abs(number) >= 1) return number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
      if (number === 0) return '0'
      return number.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
    }

    function formatTokens(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      if (number >= 1_000_000) return (number / 1_000_000).toFixed(2) + 'M'
      if (number >= 1_000) return (number / 1_000).toFixed(1) + 'k'
      return String(Math.round(number))
    }

    function formatRate(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      if (number === 0) return '0'
      return number.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
    }

    function formatClock(iso) {
      if (!iso) return ''
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      const pad = number => String(number).padStart(2, '0')
      return pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    function shortTime(iso) {
      if (!iso) return ''
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      const now = new Date()
      const sameDay = date.toDateString() === now.toDateString()
      if (sameDay) return formatClock(iso)
      return (date.getMonth() + 1) + '/' + date.getDate() + ' ' + formatClock(iso)
    }

    function shorten(text, length) {
      const value = String(text || '')
      return value.length > length ? value.slice(0, length - 1) + '…' : value
    }

    function accountName(account) {
      const nickname = String(account.nickname || '').trim()
      if (nickname) return shorten(nickname, 12)
      return String(account.uid || '').slice(0, 8)
    }

    // -----------------------------------------------------------------------
    // 每日积分预算（网关强制，插件只读展示）
    // -----------------------------------------------------------------------

    /** 数字或 null：旧快照缺字段与 Qoder 面板的 null 都按「未知」处理，不能当 0。 */
    function optionalNumber(value) {
      if (value === null || value === undefined || value === '') return null
      const number = Number(value)
      return Number.isFinite(number) ? number : null
    }

    /**
     * 账号的每日预算视图。limit>0 才算启用；旧快照没有这三个字段时 enabled=false，
     * 展示继续走 todayCredits 的旧口径（与 1.3.0 行为一致）。
     */
    function dailyBudget(account) {
      const limit = Number(account && account.dailyCreditLimit)
      const enabled = Number.isFinite(limit) && limit > 0
      const spent = optionalNumber(account && account.dailyCreditSpent)
      const used = spent !== null ? spent : optionalNumber(account && account.todayCredits)
      return {
        enabled,
        limit: enabled ? limit : 0,
        used,
        // 剩余按网关口径 limit - 已用；已超额时显示 0，不出现负数
        remaining: enabled && used !== null ? Math.max(0, limit - used) : null,
        capped: account && account.capped === true,
      }
    }

    /** 本次快照的账号是否全部满额（至少 1 个）；旧快照没有 capped 字段时恒为 false。 */
    function allAccountsCapped(entries) {
      return entries.length > 0 && entries.every(entry => entry && entry.account && entry.account.capped === true)
    }

    // -----------------------------------------------------------------------
    // 限流状态：网关 6004 模型级台账 + 连败降权（until 已过的一律视为解除）
    // -----------------------------------------------------------------------

    /** 未到期的模型级限流行；until 已过的一律视为解除（缺 until 的旧快照保留但无恢复时间）。 */
    function rateLimitRows(account, nowMs) {
      const rows = Array.isArray(account && account.rateLimitedModels) ? account.rateLimitedModels : []
      const now = nowMs || Date.now()
      const out = []
      for (const row of rows) {
        const model = String((row && row.model) || '')
        if (!model) continue
        const untilMs = row.until ? Date.parse(row.until) : 0
        if (untilMs && untilMs <= now) continue
        out.push({
          model,
          until: row.until || '',
          resetAt: row.resetAt || '',
          untilMs,
          resetMs: row.resetAt ? Date.parse(row.resetAt) : 0,
        })
      }
      return out
    }

    /** 降权中的解除时刻；未降权返回 0。 */
    function degradeUntilMs(account, nowMs) {
      const ms = account && account.degradeUntil ? Date.parse(account.degradeUntil) : 0
      return ms && ms > (nowMs || Date.now()) ? ms : 0
    }

    function formatRecover(ms) {
      if (!ms) return ''
      const date = new Date(ms)
      if (Number.isNaN(date.getTime())) return ''
      const pad = number => String(number).padStart(2, '0')
      return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    /** 徽标用的短时间：同一天只显示 HH:mm，跨天显示 M/D HH:mm。 */
    function formatShortRecover(ms) {
      if (!ms) return ''
      const date = new Date(ms)
      if (Number.isNaN(date.getTime())) return ''
      const pad = number => String(number).padStart(2, '0')
      const clock = pad(date.getHours()) + ':' + pad(date.getMinutes())
      if (date.toDateString() === new Date().toDateString()) return clock
      return date.getMonth() + 1 + '/' + date.getDate() + ' ' + clock
    }

    /**
     * 限流徽标要标注的「重置时刻」：上游重置（reset_at，真正恢复可用的时间）优先，
     * 缺省用本网关的冷却结束时间（until）。多模型取最晚的一条，徽标不会把「仍有限流
     * 的号」说成更早恢复。
     */
    function limitResetMs(account) {
      let latest = 0
      for (const row of rateLimitRows(account)) {
        const ms = row.resetMs || row.untilMs
        if (ms > latest) latest = ms
      }
      return latest
    }

    /** 侧边栏行 / 设置页共用的限流摘要行（无限流无降权时为空数组）。 */
    function limitTitleLines(account, t) {
      const rows = rateLimitRows(account)
      const degradeMs = degradeUntilMs(account)
      const lines = []
      for (const row of rows) {
        lines.push(translateWith(t, 'limit.title', '限流中：{model}', { model: trimModel(row.model) }))
        // 重置时间（上游 reset_at）是真正恢复可用的时刻，作为主标注
        const resetMs = row.resetMs || row.untilMs
        if (resetMs) lines.push(translateWith(t, 'limit.reset', '重置 {time}', { time: formatRecover(resetMs) }))
        // 本网关的冷却结束时间与上游重置不同时，单独补一行说明
        if (row.untilMs && row.resetMs && row.untilMs !== row.resetMs) {
          lines.push(translateWith(t, 'limit.cooldown', '本地冷却到 {time}', { time: formatRecover(row.untilMs) }))
        }
      }
      if (degradeMs) {
        lines.push(
          translateWith(t, 'limit.degradeTitle', '连续失败降权中（{fails} 连败）', {
            fails: Math.max(1, Number(account.consecutiveFails) || 1),
          }) +
            ' · ' +
            translateWith(t, 'limit.degradeRecover', '解除 {time}', { time: formatRecover(degradeMs) }),
        )
      } else if (failStreak(account) > 0) {
        // 降权冷却已过但连败计数还在：该号对当前模型仍在失败，只是没写 6004 台账
        // （无重置时间的限流 / 其他账号级错误），靠连败计数透出。
        lines.push(translateWith(t, 'limit.failStreak', '连续失败 {fails} 次', { fails: failStreak(account) }))
      }
      return lines
    }

    /** 连败计数（0 = 无）；降权冷却过期后计数仍有效，是「还在失败」的透出。 */
    function failStreak(account) {
      const fails = Number(account && account.consecutiveFails)
      return Number.isFinite(fails) && fails > 0 ? Math.floor(fails) : 0
    }

    // -----------------------------------------------------------------------
    // 通用小件
    // -----------------------------------------------------------------------

    const CSS = [
      '.wbcd-dock{display:flex;align-items:center;gap:8px;padding:1px 2px 0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap;font-variant-numeric:tabular-nums}',
      '.wbcd-label{font-weight:600;letter-spacing:.01em}',
      '.wbcd-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}',
      '.wbcd-dot.wbcd-checked{background:var(--dsw-alias-state-success-primary)}',
      '.wbcd-dot.wbcd-failed{background:var(--dsw-alias-state-error-primary)}',
      '.wbcd-dot.wbcd-unknown{background:var(--dsw-alias-state-warn-primary)}',
      '.wbcd-session{font-variant-numeric:tabular-nums}',
      '.wbcd-offline{font-size:11px;color:var(--dsw-alias-state-error-primary)}',
      '.wbcd-side{box-sizing:border-box;width:calc(100% + 4px);margin:4px -2px 8px;padding:8px 8px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:4px;flex:1 1 auto;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;overflow:hidden}',
      '.wbcd-side-head{display:flex;align-items:center;gap:6px;margin-bottom:1px}',
      '.wbcd-side-title{flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wbcd-side-refresh{border:none;background:transparent;color:var(--dsw-alias-label-secondary);padding:2px;border-radius:4px;cursor:pointer;display:inline-flex;line-height:0;flex:none}',
      '.wbcd-side-refresh:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.wbcd-side-refresh:disabled{opacity:.45;cursor:default}',
      // 侧边栏标题行的「消耗优先级」紧凑切换 chip（点击切到另一个平台）
      '.wbcd-side-routing{flex:none;display:inline-flex;align-items:center;font-size:10px;line-height:14px;padding:0 5px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;white-space:nowrap}',
      '.wbcd-side-routing:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.wbcd-side-routing:disabled{opacity:.5;cursor:default}',
      '.wbcd-side-routing-err{font-size:10px;line-height:14px;color:var(--dsw-alias-state-error-primary)}',
      '.wbcd-side-row{display:flex;align-items:center;gap:6px;min-width:0;padding:0 4px;margin:0 -4px;border-radius:6px;transition:background-color .15s ease}',
      '.wbcd-side-row.is-active{background:rgba(127,127,127,.18);box-shadow:inset 0 0 0 1px rgba(127,127,127,.12)}',
      // 主题可能没有定义 bg-layer-2（会出现“只有加粗、没有灰底”），这里用不受主题影响的
      // 中性灰半透明叠色，亮/暗主题都能看见。
      '.wbcd-side-row.is-active{background:color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent)}',
      '.wbcd-side-row.is-active .wbcd-side-name{color:var(--dsw-alias-label-primary);font-weight:500}',
      '.wbcd-side-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.wbcd-side-credits{flex:none;color:var(--dsw-alias-label-primary);font-weight:500}',
      '.wbcd-side-badge{flex:none;font-size:10px;line-height:14px;padding:0 4px;border-radius:4px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);font-weight:500}',
      '.wbcd-side-today{flex:none;display:inline-flex;align-items:center;gap:2px;font-size:10px;line-height:14px;padding:0 4px;border-radius:4px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);font-variant-numeric:tabular-nums}',
      '.wbcd-side-today svg{flex:none;opacity:.7}',
      // 满额：沿用宿主的警示色（错误红），不引入新样式体系
      '.wbcd-side-today.is-capped{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.wbcd-side-today.is-capped svg{opacity:1}',
      '.wbcd-side-allcapped{font-size:11px;line-height:16px;color:var(--dsw-alias-state-error-primary)}',
      '.wbcd-side-flag{flex:none;font-size:10px;line-height:14px;padding:0 4px;border-radius:4px;color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-state-error-primary)}',
      '.wbcd-side-flag-degrade{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.wbcd-side-offline{color:var(--dsw-alias-state-error-primary);flex:none}',
      '.wbcd-side-muted,.wbcd-side-error{box-sizing:border-box;width:calc(100% + 4px);margin:4px -2px 8px;padding:6px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.wbcd-side-error{color:var(--dsw-alias-state-error-primary)}',
      '.wbcd-error{color:var(--dsw-alias-state-error-primary);font-size:12px;padding:1px 2px}',
      '.wbcd-turn{display:flex;justify-content:flex-end;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary);opacity:.9;font-variant-numeric:tabular-nums}',
      '.wbcd-page{display:flex;flex-direction:column;gap:18px;padding:4px 0 24px;font-size:13px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.wbcd-page-title{margin:0;font-size:15px;font-weight:600}',
      '.wbcd-page-desc{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.wbcd-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.wbcd-sub{font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.wbcd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}',
      '.wbcd-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:6px}',
      '.wbcd-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px}',
      '.wbcd-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wbcd-realm{font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:0 6px;line-height:18px;flex:none}',
      '.wbcd-big{font-size:24px;font-weight:600;line-height:1.2}',
      '.wbcd-unit{font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary);margin-left:4px}',
      '.wbcd-line{font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.wbcd-btn{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;line-height:18px}',
      '.wbcd-btn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.wbcd-btn:disabled{opacity:.5;cursor:default}',
      // 优先消耗：互斥平台按钮的选中态（绿色边框 + 绿色文字，沿用宿主状态色）
      '.wbcd-btn.is-active{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary);font-weight:600}',
      '.wbcd-routing-options{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
      '.wbcd-routing-meta{font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;gap:10px;flex-wrap:wrap;align-items:center}',
      '.wbcd-table{width:100%;border-collapse:collapse;font-size:12px}',
      '.wbcd-table th,.wbcd-table td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}',
      '.wbcd-table th{color:var(--dsw-alias-label-secondary);font-weight:500}',
      '.wbcd-table tr:last-child td{border-bottom:none}',
      '.wbcd-num{text-align:right !important}',
      '.wbcd-empty{font-size:12px;color:var(--dsw-alias-label-secondary);padding:8px 0}',
      '.wbcd-notice{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.wbcd-notice.wbcd-bad,.wbcd-bad{color:var(--dsw-alias-state-error-primary)}',
      '.wbcd-section-title{font-size:13px;font-weight:600;margin:0 0 8px}',
      '.wbcd-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.6}',
    ].join('')

    function StyleTag() {
      return h('style', { key: 'wbcd-style' }, CSS)
    }

    function checkinVisual(account, t) {
      const record = account && account.checkin
      if (!record) return { state: 'idle', text: translateWith(t, 'checkin.unknown', '今日签到状态未知'), record: null }
      if (record.state === 'checked') {
        const fresh = record.fresh === true
        return {
          state: 'checked',
          text: translateWith(t, fresh ? 'checkin.fresh' : 'checkin.checked', fresh ? '今日已签到（本次补签）' : '今日已签到'),
          record,
        }
      }
      if (record.state === 'failed') {
        return {
          state: 'failed',
          text: translateWith(t, 'checkin.failed', '签到失败：{message}', { message: shorten(record.message, 80) }),
          record,
        }
      }
      // 已知今天还没签到（Qoder 面板 lastCheckin 不是今天）：黄点 + 明确文案，
      // 不再和「状态未知」混在一起。
      if (record.state === 'pending') {
        const text = record.message ? shorten(record.message, 80) : translateWith(t, 'checkin.pending', '今日尚未签到')
        return { state: 'unknown', text, record }
      }
      return { state: 'unknown', text: translateWith(t, 'checkin.unknown', '今日签到状态未知'), record }
    }

    // -----------------------------------------------------------------------
    // 积分优先消耗（平台级，Host 通过 new-api 渠道优先级实现）
    // -----------------------------------------------------------------------

    /** Host 未升级 / 未配置 newApi 时快照没有 routing 字段：整块隐藏，不报错。 */
    function routingView(data) {
      const routing = data && data.routing
      return routing && routing.enabled === true ? routing : null
    }

    /** 当前生效的优先平台（'workbuddy' | 'qoder' | ''）：actualMode 优先，回落用户选择。 */
    function routingMode(routing) {
      const actual = routing && typeof routing.actualMode === 'string' ? routing.actualMode : ''
      if (actual === 'workbuddy' || actual === 'qoder') return actual
      const desired = routing && typeof routing.mode === 'string' ? routing.mode : ''
      return desired === 'workbuddy' || desired === 'qoder' ? desired : ''
    }

    function routingActualLabel(routing, tr) {
      const actual = routing && routing.actualMode
      if (actual === 'workbuddy') return tr('routing.actual.workbuddy', 'WorkBuddy 优先')
      if (actual === 'qoder') return tr('routing.actual.qoder', 'Qoder 优先')
      if (actual === 'tie') return tr('routing.actual.tie', '两个渠道同级')
      return tr('routing.actual.none', '未知')
    }

    /** 渠道优先级（快照缺失字段时回落到配置里的期望值）。 */
    function routingPriorities(routing) {
      const channels = (routing && routing.channels) || {}
      const wb = channels.workbuddy && Number.isFinite(Number(channels.workbuddy.priority))
        ? Number(channels.workbuddy.priority)
        : Number(routing && routing.preferredPriority)
      const qoder = channels.qoder && Number.isFinite(Number(channels.qoder.priority))
        ? Number(channels.qoder.priority)
        : Number(routing && routing.fallbackPriority)
      return {
        workbuddy: Number.isFinite(wb) ? wb : '—',
        qoder: Number.isFinite(qoder) ? qoder : '—',
      }
    }

    function accountTitle(account, t) {
      const visual = checkinVisual(account, t)
      const at = visual.record && visual.record.at ? ' ' + formatClock(visual.record.at) : ''
      return [
        account.nickname || account.uid,
        account.credits + ' 积分',
        visual.text + at,
      ].join(' · ')
    }

    function RefreshIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'M8 2.6a5.4 5.4 0 1 0 5.1 7.2h-1.7A3.8 3.8 0 1 1 8 4.2c1 0 1.9.4 2.6 1.1l-1.4 1.4h3.9V2.8l-1.2 1.2A5.36 5.36 0 0 0 8 2.6Z',
          fill: 'currentColor',
        }),
      )
    }

    /** 今日消耗的小图标：向下箭头（表示扣分/下降）。 */
    function TodayIcon() {
      return h(
        'svg',
        { viewBox: '0 0 10 10', width: 9, height: 9, 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'M5 1.3v7M2.5 5.5 5 8l2.5-2.5',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 1.2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
      )
    }

    // -----------------------------------------------------------------------
    // 输入框下方状态条
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // 「移动访问」停靠几何
    // -----------------------------------------------------------------------

    /**
     * 把 dsh-mobile 的「移动访问」按钮停到账户行右侧（账户名之后、连接状态灯之前）：
     * 右端贴账户按钮的内容右端，垂直居中；同时给出账户按钮需要让出的 padding，
     * 否则 fixed 的按钮会压住账户名。入参是真实渲染矩形（px）。
     */
    function parkGeometry(anchorRect, triggerWidth, viewportWidth) {
      const gap = 8 // 与账户名的横向间距
      const height = 42 // 与 footer 行动作同高
      const inset = 4 // 距账户按钮右端的内缩
      const right = Math.max(0, Math.round(viewportWidth - (anchorRect.right - inset)))
      const top = Math.round(anchorRect.top + (anchorRect.height - height) / 2)
      return { right, top, height, padRight: Math.ceil(triggerWidth + gap + 2) }
    }

    // -----------------------------------------------------------------------
    // 侧边栏底部区块（账户积分 + 每日签到）
    // 席位：sidebar.footer.action —— 渲染在「设置/账户」行正上方，展开时独占一行。
    // -----------------------------------------------------------------------

    const SidebarCredits = React.memo(function SidebarCredits(props) {
      const state = useStore()
      const data = state.data
      const [busy, setBusy] = React.useState(false)
      const wide = props.wide !== false
      const tr = (key, fallback, vars) => translateWith(props.t, key, fallback, vars)

      const onRefresh = React.useCallback(() => {
        if (busy) return
        setBusy(true)
        fetch(API + '/refresh', { method: 'POST', cache: 'no-store' })
          .catch(() => {})
          .then(() => store.refresh())
          .finally(() => setBusy(false))
      }, [busy])

      // 平台优先消耗：标题行 chip 点击切到另一个平台（Host 侧改 new-api 渠道优先级）。
      // Host 未升级/未配置 newApi 时快照没有 routing 字段，整个控件不渲染。
      const routing = routingView(data)
      const [routingBusy, setRoutingBusy] = React.useState(false)
      const [routingError, setRoutingError] = React.useState('')
      const routingTarget = routingMode(routing) === 'qoder' ? 'workbuddy' : 'qoder'
      const onSwitchRouting = React.useCallback(() => {
        if (routingBusy) return
        setRoutingBusy(true)
        setRoutingError('')
        fetch(API + '/preference?mode=' + encodeURIComponent(routingTarget), { method: 'POST', cache: 'no-store' })
          .then(async response => {
            const text = await response.text()
            if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 120))
            let payload = null
            try {
              payload = JSON.parse(text)
            } catch {
              // 旧 Host / 空响应：按成功处理，状态交给下一次快照
            }
            if (payload && payload.ok === false) throw new Error(payload.error || 'switch failed')
          })
          .catch(error => setRoutingError(error && error.message ? error.message : String(error)))
          .finally(() => {
            setRoutingBusy(false)
            store.refresh()
          })
      }, [routingBusy, routingTarget])

      // 布局：dsh-mobile 的「移动访问」按钮和本插件同占 sidebar.footer.action（一行 flex）。
      // 用户要它停在侧边栏底部的账户行右侧，账户行上方只留 WorkBuddy 积分块。
      // 用 fixed 定位把按钮贴到账户行右端，并给账户按钮加右 padding 让出位置——
      // 不搬 DOM：按钮由 dsh-mobile 的 React 组件渲染在 footer 槽位里，搬走会在下一次
      // 重渲染时被打回原位。按钮自身是 width:100% 的整行动作，一旦 fixed 就会按视口算宽
      // （上一版按钮跑到主区域下方、宽得离谱的根因），所以必须显式收窄成 width:auto。
      // 停靠点只依赖两个稳定特征：dsh-mobile 的 trigger class 和 SettingsRoot 的账户行
      // 类名后缀 _triggerRow，不假设中间 DOM 层级；锚点用账户按钮自己的矩形——它上面的
      // slot 包装层可能是 display:contents（无盒子、rect 全 0），拿祖先当锚点会算出 0 宽。
      // 收起成 56px 轨道（is-rail）时不贴，并还原按钮与 padding。
      // React 重挂 / 侧边栏宽度变化时由 observer + resize + 定时兜底重新贴。
      React.useEffect(() => {
        if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return
        const TRIGGER = '.dsh-mobile-control__trigger:not(.is-rail)'
        const ACCOUNT = 'button[data-collapsed][aria-haspopup="menu"]'
        const ROW = '[class*="_triggerRow"]'
        const FIXED_STYLES = ['position', 'right', 'left', 'top', 'width', 'maxWidth', 'height', 'margin', 'zIndex']
        let parkedTrigger = null
        let parkedButton = null

        function unpark() {
          if (parkedTrigger) {
            for (const name of FIXED_STYLES) parkedTrigger.style[name] = ''
            parkedTrigger = null
          }
          if (parkedButton) {
            parkedButton.style.paddingRight = ''
            parkedButton = null
          }
        }

        function park() {
          const trigger = document.querySelector(TRIGGER)
          if (!trigger) return unpark()
          // 账户按钮只认侧边栏底部那一行，设置弹窗里可能有同属性按钮，按 DOM 顺序取第一个在 footArea 内的
          let accountBtn = null
          for (const candidate of document.querySelectorAll(ACCOUNT)) {
            const row = candidate.closest(ROW)
            if (row && row.closest('[class*="_footArea"]')) {
              accountBtn = candidate
              break
            }
          }
          if (!accountBtn) return unpark()
          // 用账户按钮自身的矩形：它是整行宽（width:100%），slot 包装层可能是 display:contents
          // （没有盒子、rect 全 0），拿祖先元素做锚点会算出 0 宽。
          const btnRect = accountBtn.getBoundingClientRect()
          if (btnRect.width < 80) return unpark() // 收起态或尚未布局
          // 先落 fixed 再量宽：width:auto 才是「图标 + 移动访问」的自然宽度（含两侧 padding）
          trigger.style.position = 'fixed'
          trigger.style.width = 'auto'
          trigger.style.maxWidth = '160px'
          trigger.style.margin = '0'
          trigger.style.zIndex = '60'
          const width = trigger.getBoundingClientRect().width || 88
          // 用文档客户区宽度而不是 innerWidth：后者含滚动条宽度，会把按钮往右偏
          const viewportWidth = (document.documentElement && document.documentElement.clientWidth) || window.innerWidth
          const geometry = parkGeometry(btnRect, width, viewportWidth)
          trigger.style.right = geometry.right + 'px'
          trigger.style.top = geometry.top + 'px'
          trigger.style.height = geometry.height + 'px'
          // 让位：加在账户按钮自己的右 padding 上，标签自动省略号；不动祖先（可能是 display:contents）
          accountBtn.style.paddingRight = geometry.padRight + 'px'
          parkedTrigger = trigger
          parkedButton = accountBtn
        }

        let frame = 0
        const schedule = () => {
          if (frame) return
          frame = requestAnimationFrame(() => {
            frame = 0
            park()
          })
        }

        park()
        let observer = null
        try {
          observer = new MutationObserver(schedule)
          observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
        } catch {
          // 老浏览器没有 MutationObserver 时靠 resize + 定时兜底
        }
        const timer = setInterval(schedule, 1500)
        const onResize = () => schedule()
        window.addEventListener('resize', onResize)
        return () => {
          if (observer) observer.disconnect()
          clearInterval(timer)
          if (frame) cancelAnimationFrame(frame)
          window.removeEventListener('resize', onResize)
          unpark()
        }
      }, [])

      // 收起成 56px 轨道时没有横向空间：让位给底部的设置/账户图标。
      if (!wide) return null

      if (!data && state.error) {
        return h(
          'div',
          { className: 'wbcd-side wbcd-side-error', title: state.error },
          h(StyleTag),
          translateWith(props.t, 'dock.error', 'WorkBuddy 网关未连接'),
        )
      }
      if (!data) {
        return h(
          'div',
          { className: 'wbcd-side wbcd-side-muted' },
          h(StyleTag),
          translateWith(props.t, 'dock.loading', 'WorkBuddy 积分读取中…'),
        )
      }

      const gateway = data.gateway || {}
      const qoder = data.qoder || { enabled: false }
      const accounts = Array.isArray(gateway.accounts) ? gateway.accounts : []
      // 统一布局：WorkBuddy / Qoder 账号共用同一行结构与来源徽标。
      // 签到状态只由每行最左侧状态点表达（绿=今日已签到），不再单独占底部一行。
      const qoderAccounts = qoder && qoder.enabled && Array.isArray(qoder.accounts) ? qoder.accounts : []
      const rows = [
        ...accounts.map(account => ({ key: account.uid, account, source: 'workbuddy' })),
        ...qoderAccounts.map(account => ({ key: 'qoder-' + account.uid, account, source: 'qoder' })),
      ]
      // 正在消耗的账号：Host 从两个网关的「最近一次请求」里挑最新的一条，
      // 这里只给对应行加选中态的灰色底，不另占一行。
      const activity = data.activity && typeof data.activity === 'object' ? data.activity : null
      // 行 key 与 activity.uid 对齐（Qoder 行 key 带 'qoder-' 前缀）
      const activeKey =
        activity && activity.active
          ? activity.source === 'qoder'
            ? 'qoder-' + activity.uid
            : String(activity.uid || '')
          : ''
      // 全部账号都满额时给一行提示（没有满额或旧快照不显示）
      const allCapped = allAccountsCapped(rows)

      return h(
        'div',
        { className: 'wbcd-side' },
        h(StyleTag),
        h(
          'div',
          { className: 'wbcd-side-head' },
          h('span', { className: 'wbcd-side-title' }, translateWith(props.t, 'sidebar.title', 'Free Egg 积分')),
          routing && routing.available
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'wbcd-side-routing',
                  disabled: routingBusy,
                  title: tr('routing.sidebar.switchTo', '消耗优先级：{actual}（点击切换为「{next}」优先）', {
                    actual: routingActualLabel(routing, tr),
                    next: routingTarget === 'qoder'
                      ? tr('routing.actual.qoder', 'Qoder 优先')
                      : tr('routing.actual.workbuddy', 'WorkBuddy 优先'),
                  }),
                  onClick: onSwitchRouting,
                },
                routingBusy
                  ? '…'
                  : routingMode(routing) === 'qoder'
                    ? tr('routing.sidebar.short.qoder', 'Qoder 优先')
                    : tr('routing.sidebar.short.workbuddy', 'WB 优先'),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'wbcd-side-refresh',
              title: translateWith(props.t, 'dock.refresh', '刷新'),
              'aria-label': translateWith(props.t, 'dock.refresh', '刷新'),
              onClick: onRefresh,
              disabled: busy,
            },
            h(RefreshIcon),
          ),
        ),
        routingError
          ? h(
              'div',
              { className: 'wbcd-side-routing-err', title: routingError },
              tr('routing.sidebar.applyFailed', '切换失败：{message}', { message: shorten(routingError, 60) }),
            )
          : null,
        ...rows.map(({ key, account, source }) => {
          const limitMs = limitResetMs(account)
          const limited = source === 'workbuddy' && rateLimitRows(account).length > 0
          const degradeMs = source === 'workbuddy' ? degradeUntilMs(account) : 0
          const streak = source === 'workbuddy' ? failStreak(account) : 0
          const visual = checkinVisual(account, props.t)
          const budget = dailyBudget(account)
          const title =
            source === 'qoder'
              ? [
                  account.nickname || 'Qoder',
                  account.credits + ' 积分',
                  account.creditsTotal > 0
                    ? translateWith(props.t, 'qoder.used', '已用 {used} / {total}', {
                        used: formatBalance(account.used),
                        total: formatBalance(account.creditsTotal),
                      })
                    : '',
                  visual.text,
                ].filter(Boolean).join(' · ')
              : [accountTitle(account, props.t), ...limitTitleLines(account, props.t)].filter(Boolean).join('\n')
          // 徽标直接带出重置时间：限流 18:13 / 降权 13:46，鼠标悬停可看完整说明
          const flagText = (label, ms) => label + (ms ? ' ' + formatShortRecover(ms) : '')
          return h(
            'div',
            { key, className: 'wbcd-side-row' + (key === activeKey ? ' is-active' : ''), title },
            h('span', { className: 'wbcd-dot wbcd-' + visual.state }),
            h('span', { className: 'wbcd-side-name' }, accountName(account)),
            h('span', { className: 'wbcd-side-badge' }, source === 'qoder' ? 'Qoder' : 'WB'),
            budget.enabled && budget.used !== null
              ? h(
                  'span',
                  {
                    className: 'wbcd-side-today' + (budget.capped ? ' is-capped' : ''),
                    title: budget.capped
                      ? translateWith(props.t, 'budget.cappedTip', '今日已满额，已停用，明日 0 点恢复')
                      : translateWith(
                          props.t,
                          'budget.todayTitle',
                          '今日已用 ≈{used} / 上限 {limit}（剩余 ≈{remaining}，本地时间 0 点起）',
                          {
                            used: formatCredits(budget.used),
                            limit: formatCredits(budget.limit),
                            remaining: budget.remaining === null ? '—' : formatCredits(budget.remaining),
                          },
                        ),
                    'aria-label': translateWith(props.t, 'budget.aria', '今日已用 / 上限'),
                  },
                  h(TodayIcon),
                  formatCredits(budget.used) + '/' + formatCredits(budget.limit),
                )
              : Number.isFinite(Number(account.todayCredits))
                ? h(
                    'span',
                    {
                      className: 'wbcd-side-today',
                      title: translateWith(props.t, 'sidebar.todayTitle', '今日已消耗 ≈{credits} 积分（本地时间 0 点起）', {
                        credits: formatCredits(account.todayCredits),
                      }),
                      'aria-label': translateWith(props.t, 'sidebar.today', '今日消耗'),
                    },
                    h(TodayIcon),
                    formatCredits(account.todayCredits),
                  )
                : null,
            limited
              ? h('span', { className: 'wbcd-side-flag' }, flagText(translateWith(props.t, 'limit.flag', '限流'), limitMs))
              : degradeMs > 0
                ? h('span', { className: 'wbcd-side-flag wbcd-side-flag-degrade' }, flagText(translateWith(props.t, 'limit.degrade', '降权'), degradeMs))
                : streak > 0
                  ? h('span', { className: 'wbcd-side-flag wbcd-side-flag-degrade' }, translateWith(props.t, 'limit.streak', '连败'))
                  : null,
            h('span', { className: 'wbcd-side-credits' }, formatBalance(account.credits)),
          )
        }),
        allCapped
          ? h(
              'div',
              { className: 'wbcd-side-allcapped' },
              translateWith(props.t, 'budget.allCapped', '今日额度已用完：DeepSeek 已自动降级到 Qwen3.8-Flash（免费）'),
            )
          : null,
      )
    })

    // -----------------------------------------------------------------------
    // 输入框下方：只保留本会话消耗的积分
    // -----------------------------------------------------------------------

    const DockStrip = React.memo(function DockStrip(props) {
      const state = useSessionStore(props.sessionId)
      const data = state.data

      if (!data && state.error) {
        return h(
          'div',
          { className: 'wbcd-dock wbcd-error', title: state.error },
          h(StyleTag),
          translateWith(props.t, 'dock.error', 'WorkBuddy 网关未连接'),
        )
      }
      if (!data) return null

      const gateway = data.gateway || {}
      const session = data.session || {}
      const totalCredits = Number(session.totalCredits)
      const rows = Array.isArray(session.turns) ? session.turns : []
      // pricedTurns 是 Host 新版本字段；旧快照按行内 credits 兜底，避免跨版本错位。
      const pricedTurns =
        session.pricedTurns !== undefined
          ? Number(session.pricedTurns)
          : rows.filter(row => row && row.credits !== null && row.credits !== undefined).length
      const freeEgg = session.freeEgg === true
      // 显示条件：
      //   1. 当前对话用的是 free-egg provider 的模型 → 一直显示（首轮前 ≈0，缺单价时提示等待）；
      //   2. 否则维持旧行为：只有这条对话真的算出过积分才显示，避免用官方模型时误导。
      if (!freeEgg && (rows.length === 0 || pricedTurns <= 0 || !Number.isFinite(totalCredits))) return null
      if (freeEgg && !Number.isFinite(totalCredits)) return null

      const pending = freeEgg && rows.length > 0 && pricedTurns <= 0
      const model = trimModel(session.currentModel || '')
      const title = [
        rows.length + ' 轮',
        formatTokens(session.totalTokens) + ' tokens',
        model,
        session.currentProvider || '',
      ]
        .filter(Boolean)
        .join(' · ')
      const text = pending
        ? translateWith(props.t, 'dock.pending', '本会话 · 等待单价')
        : translateWith(props.t, 'dock.session', '本会话 ≈{credits} 积分', { credits: formatCredits(totalCredits) })

      return h(
        'div',
        { className: 'wbcd-dock' },
        h(StyleTag),
        h('span', { className: 'wbcd-label', title: gateway.baseUrl || '' }, translateWith(props.t, 'dock.label', 'Free Egg')),
        h('span', { className: 'wbcd-session', title }, text),
        gateway.online === false
          ? h('span', { className: 'wbcd-offline', title: gateway.error || '' }, '离线')
          : null,
      )
    })

    // -----------------------------------------------------------------------
    // 每轮对话消耗
    // -----------------------------------------------------------------------

    const TurnCost = React.memo(function TurnCost(props) {
      const state = useSessionStore(props.sessionId)
      const data = state.data
      const turnNo = Number(props.turn)
      const session = data && data.session
      const rows = session && Array.isArray(session.turns) ? session.turns : null
      const row = rows && Number.isFinite(turnNo) ? rows.find(item => Number(item.turn) === turnNo) : null
      const hasRow = !!row && row.credits !== null && row.credits !== undefined

      // 轮次刚结束时账本里应已有数据，挂载后短延迟补一次拉取（仓库内部有节流）。
      React.useEffect(() => {
        if (!hasRow) store.loadSoon(1200)
      }, [hasRow, turnNo])

      if (!hasRow) return null
      const credits = Number(row.credits)
      const paid = credits > 0
      const label = paid
        ? translateWith(props.t, 'turn.credits', '本轮 ≈{credits} 积分', { credits: formatCredits(credits) })
        : translateWith(props.t, 'turn.free', '本轮未计积分')
      const models = (row.models || []).map(trimModel).filter(Boolean)
      const title = translateWith(props.t, 'turn.title', '本轮 {tokens} tokens · {models}', {
        tokens: formatTokens(row.tokens),
        models: models.length > 0 ? models.join(' / ') : '—',
      })
      return h('div', { className: 'wbcd-turn', title }, h(StyleTag), label)
    })

    // -----------------------------------------------------------------------
    // 设置页详情
    // -----------------------------------------------------------------------

    const SettingsPage = React.memo(function SettingsPage(props) {
      const tr = (key, fallback, vars) => translateWith(props.t, key, fallback, vars)
      const state = useStore()
      const [recent, setRecent] = React.useState(null)
      const [recentError, setRecentError] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [routingBusy, setRoutingBusy] = React.useState('')
      const [notice, setNotice] = React.useState('')

      const loadRecent = React.useCallback(() => {
        fetch(API + '/sessions?limit=6', { cache: 'no-store' })
          .then(async response => {
            const text = await response.text()
            if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 120))
            return JSON.parse(text)
          })
          .then(payload => {
            setRecent(payload)
            setRecentError(payload && payload.error ? payload.error : '')
          })
          .catch(error => setRecentError(error && error.message ? error.message : String(error)))
      }, [])

      React.useEffect(() => {
        store.load()
        loadRecent()
      }, [loadRecent])

      const data = state.data
      const gateway = (data && data.gateway) || null
      const qoder = (data && data.qoder) || { enabled: false }
      const session = (data && data.session) || null
      const accounts = gateway && Array.isArray(gateway.accounts) ? gateway.accounts : []
      const qoderAccounts = qoder && Array.isArray(qoder.accounts) ? qoder.accounts : []
      // 统一账号卡：两种来源共用同一张卡片结构（名称/徽标/余额/签到/用量/操作）
      const accountRows = [
        ...accounts.map(account => ({ account, source: 'workbuddy' })),
        ...qoderAccounts.map(account => ({ account, source: 'qoder' })),
      ]
      // 全部账号都满额时在页面顶部给一行提示（没有满额或旧快照不显示）
      const allCapped = allAccountsCapped(accountRows)
      // 平台优先消耗：Host 未升级/未配置 newApi 时为空，整块隐藏
      const routing = routingView(data)
      const routingPri = routingPriorities(routing)

      const runAction = React.useCallback(
        (label, path) => {
          setBusy(label)
          setNotice('')
          return fetch(API + path, { method: 'POST', cache: 'no-store' })
            .then(async response => {
              const text = await response.text()
              if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 160))
              return text
            })
            .then(() => {
              setNotice('')
              loadRecent()
              return store.refresh()
            })
            .catch(error => {
              setNotice(tr('settings.noticeFailed', '操作失败：{message}', {
                message: error && error.message ? error.message : String(error),
              }))
            })
            .finally(() => setBusy(''))
        },
        [loadRecent, tr],
      )

      /**
       * 平台优先消耗切换：POST /preference?mode=workbuddy|qoder。
       * Host 会改 new-api 两个渠道的优先级，成功后 store.refresh() 回读真实状态。
       */
      const runRouting = mode => {
        if (routingBusy) return
        setRoutingBusy(mode)
        setNotice('')
        fetch(API + '/preference?mode=' + encodeURIComponent(mode), { method: 'POST', cache: 'no-store' })
          .then(async response => {
            const text = await response.text()
            if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 160))
            let payload = null
            try {
              payload = JSON.parse(text)
            } catch {
              // 旧 Host / 空响应：状态交给下一次快照判定
            }
            if (payload && payload.ok === false) throw new Error(payload.error || 'switch failed')
          })
          .catch(error =>
            setNotice(
              tr('routing.failed', '切换失败：{message}', {
                message: error && error.message ? error.message : String(error),
              }),
            ),
          )
          .finally(() => {
            setRoutingBusy('')
            store.refresh()
          })
      }

      const priceLine = (() => {
        if (!gateway) return null
        const detail = Array.isArray(gateway.priceDetail) ? gateway.priceDetail : []
        if (detail.length === 0) return tr('settings.priceNone', '暂无实测单价，暂时只显示 token')
        const marker = '（' + tr('settings.estimated', '估算') + '）'
        // 只展开「当前对话用到的模型」；目录估价模型很多，其余用计数汇总。
        const used = new Set()
        for (const row of (session && session.turns) || []) {
          for (const model of row.models || []) used.add(trimModel(model).toLowerCase())
        }
        if (session && session.currentModel) used.add(trimModel(session.currentModel).toLowerCase())
        const measuredRows = detail.filter(row => row.measured === true || row.source === 'config')
        const usedRows = detail.filter(row => used.has(trimModel(row.model).toLowerCase()))
        const shown = (usedRows.length > 0 ? usedRows : measuredRows).slice(0, 6)
        const parts = shown.map(row =>
          trimModel(row.model) + ' ' + formatRate(row.costPer1k) + ' 积分/千 token' + (row.estimated === true ? marker : ''),
        )
        const estimatedCount = detail.filter(row => row.estimated === true).length
        const freeCount = detail.filter(row => row.estimated !== true && Number(row.costPer1k) === 0).length
        const extras = []
        if (estimatedCount > 0) {
          extras.push(tr('settings.priceEstimatedCount', '{count} 个模型按倍率估算', { count: estimatedCount }))
        }
        if (freeCount > 0) extras.push(tr('settings.priceFreeCount', '{count} 个模型免费', { count: freeCount }))
        const count = detail.length
        const basis =
          gateway.priceBasis === 'config'
            ? tr('settings.priceConfig', '在插件配置里覆盖')
            : gateway.priceBasis === 'catalog'
              ? tr('settings.priceCatalog', '按模型倍率折算（以实测单价为基线） · {count} 个模型', { count })
              : gateway.priceBasis === 'gateway+catalog'
                ? tr('settings.priceMixed', '网关实测 + 按模型倍率折算 · {count} 个模型', { count })
                : tr('settings.priceGateway', '按网关实测扣费台账加权 · {count} 个模型', { count })
        return parts.join('，') + (extras.length > 0 ? '；' + extras.join('，') : '') + '（' + basis + '）'
      })()

      // 统一账号卡：WorkBuddy / Qoder 同结构，差异只在徽标文案与签到路由。
      const renderAccountCard = (account, source) => {
        const isQoder = source === 'qoder'
        const visual = checkinVisual(account, props.t)
        const last = account.lastSuccess ? shortenTime(account.lastSuccess) : ''
        const limitRows = isQoder ? [] : rateLimitRows(account)
        const degradeMs = isQoder ? 0 : degradeUntilMs(account)
        const badge = isQoder ? 'QODER' : String(account.realm || '').toUpperCase()
        const total = Number(account.creditsTotal) || 0
        const used = Number(account.used) || 0
        const checkinBusy = isQoder ? 'qoder-checkin' : account.uid
        const budget = dailyBudget(account)
        return h(
          'div',
          { key: source + '-' + account.uid, className: 'wbcd-card' },
          h(
            'div',
            { className: 'wbcd-card-head' },
            h('span', { className: 'wbcd-name', title: account.nickname || account.uid }, account.nickname || account.uid.slice(0, 8)),
            h('span', { className: 'wbcd-realm' }, badge),
          ),
          h(
            'div',
            null,
            h('span', { className: 'wbcd-big' }, formatBalance(account.credits)),
            h('span', { className: 'wbcd-unit' }, '积分'),
          ),
          h(
            'div',
            { className: 'wbcd-line' },
            h('span', { className: 'wbcd-dot wbcd-' + visual.state }),
            h('span', null, visual.text),
            visual.record && visual.record.at ? h('span', null, formatClock(visual.record.at)) : null,
          ),
          total > 0
            ? h('div', { className: 'wbcd-line' }, tr('settings.usage', '已用 {used} / 总 {total}', {
                used: formatBalance(used),
                total: formatBalance(total),
              }))
            : null,
          budget.enabled && budget.used !== null
            ? h(
                'div',
                { className: 'wbcd-line' },
                tr('settings.todayBudget', '今日已用 ≈{used} / {limit}（剩余 ≈{remaining}）', {
                  used: formatCredits(budget.used),
                  limit: formatCredits(budget.limit),
                  remaining: budget.remaining === null ? '—' : formatCredits(budget.remaining),
                }),
              )
            : Number.isFinite(Number(account.todayCredits))
              ? h('div', { className: 'wbcd-line' }, tr('settings.today', '今日消耗 ≈{credits} 积分', {
                  credits: formatCredits(account.todayCredits),
                }))
              : null,
          budget.capped
            ? h('div', { className: 'wbcd-line wbcd-bad' }, tr('settings.capped', '今日已满额，账号已停用，明日 0 点恢复'))
            : null,
          last ? h('div', { className: 'wbcd-line' }, tr('settings.lastSuccess', '最近成功 {time}', { time: last })) : null,
          !isQoder && account.cooling ? h('div', { className: 'wbcd-line wbcd-bad' }, '冷却中') : null,
          ...limitRows.map(row => {
            const resetMs = row.resetMs || row.untilMs
            const cooling = row.untilMs && row.resetMs && row.untilMs !== row.resetMs
            return [
              h(
                'div',
                { key: 'limit-' + row.model, className: 'wbcd-line wbcd-bad' },
                h('span', { title: row.reason || '' }, translateWith(props.t, 'limit.title', '限流中：{model}', { model: trimModel(row.model) })),
                resetMs ? h('span', null, translateWith(props.t, 'limit.reset', '重置 {time}', { time: formatRecover(resetMs) })) : null,
              ),
              cooling
                ? h(
                    'div',
                    { key: 'limit-cool-' + row.model, className: 'wbcd-line wbcd-hint' },
                    translateWith(props.t, 'limit.cooldown', '本地冷却到 {time}', { time: formatRecover(row.untilMs) }),
                  )
                : null,
            ]
          }),
          degradeMs
            ? h(
                'div',
                { className: 'wbcd-line wbcd-bad' },
                translateWith(props.t, 'limit.degradeTitle', '连续失败降权中（{fails} 连败）', {
                  fails: Math.max(1, Number(account.consecutiveFails) || 1),
                }),
                h('span', null, translateWith(props.t, 'limit.degradeRecover', '解除 {time}', { time: formatRecover(degradeMs) })),
              )
            : !isQoder && failStreak(account) > 0
              ? h(
                  'div',
                  { className: 'wbcd-line wbcd-bad' },
                  translateWith(props.t, 'limit.failStreak', '连续失败 {fails} 次', { fails: failStreak(account) }),
                )
              : null,
          account.disabled
            ? h(
                'div',
                { className: 'wbcd-line wbcd-bad' },
                translateWith(props.t, 'limit.banned', '已被上游封禁：{reason}', { reason: account.disabledReason || '—' }),
              )
            : null,
          h(
            'div',
            { className: 'wbcd-row' },
            h(
              'button',
              {
                type: 'button',
                className: 'wbcd-btn',
                disabled: busy !== '',
                onClick: () =>
                  isQoder
                    ? runAction('qoder-checkin', '/qoder/checkin').then(() => store.refresh())
                    : runAction(account.uid, '/checkin?uid=' + encodeURIComponent(account.uid)),
              },
              busy === checkinBusy ? tr('settings.checking', '签到中…') : tr(isQoder ? 'qoder.checkin' : 'settings.checkin', '立即签到'),
            ),
          ),
        )
      }

      const updated = gateway && gateway.updatedAt ? shortTime(gateway.updatedAt) : ''

      return h(
        'div',
        { className: 'wbcd-page' },
        h(StyleTag),
        h(
          'div',
          null,
          h('h2', { className: 'wbcd-page-title' }, tr('section.title', 'Free Egg 积分')),
          h('p', { className: 'wbcd-page-desc' }, tr('section.desc', '国内账号可用积分、每日签到状态，以及每条对话消耗的积分。')),
        ),
        allCapped
          ? h(
              'div',
              { className: 'wbcd-notice wbcd-bad' },
              tr('budget.allCapped', '今日额度已用完：DeepSeek 已自动降级到 Qwen3.8-Flash（免费）'),
            )
          : null,
        h(
          'div',
          { className: 'wbcd-sub' },
          h('span', null, tr('settings.gateway', '网关') + ' ' + ((gateway && gateway.baseUrl) || '—')),
          updated ? h('span', null, tr('settings.updated', '更新于') + ' ' + updated) : null,
          h(
            'button',
            {
              type: 'button',
              className: 'wbcd-btn',
              disabled: busy !== '',
              onClick: () => runAction(tr('settings.refresh', '刷新'), '/refresh'),
            },
            busy === tr('settings.refresh', '刷新') ? '…' : tr('settings.refresh', '刷新'),
          ),
          gateway && gateway.online === false
            ? h('span', { className: 'wbcd-notice wbcd-bad' }, gateway.error || tr('dock.error', 'WorkBuddy 网关未连接'))
            : null,
        ),
        routing
          ? h(
              'div',
              null,
              h('div', { className: 'wbcd-section-title' }, tr('routing.title', '积分优先消耗')),
              h('div', { className: 'wbcd-hint' }, tr('routing.desc', '决定 DeepSeek 请求优先消耗哪个平台的积分，另一个平台作为故障回退。')),
              routing.available
                ? h(
                    'div',
                    { className: 'wbcd-routing-options' },
                    ...['workbuddy', 'qoder'].map(mode =>
                      h(
                        'button',
                        {
                          key: 'routing-' + mode,
                          type: 'button',
                          className: 'wbcd-btn' + (routing.actualMode === mode ? ' is-active' : ''),
                          disabled: routingBusy !== '' || busy !== '',
                          onClick: () => runRouting(mode),
                        },
                        routingBusy === mode
                          ? tr('routing.applying', '切换中…')
                          : tr(
                              mode === 'qoder' ? 'routing.qoder' : 'routing.workbuddy',
                              mode === 'qoder' ? 'Qoder 优先' : 'WorkBuddy 优先',
                            ),
                      ),
                    ),
                  )
                : h(
                    'div',
                    { className: 'wbcd-notice wbcd-bad' },
                    tr('routing.unavailable', '无法读取 new-api 渠道优先级：{message}', {
                      message: routing.error || '—',
                    }),
                  ),
              routing.available
                ? h(
                    'div',
                    { className: 'wbcd-routing-meta' },
                    tr('routing.current', '当前实际：{actual}（WB 渠道 {wb} · Qoder 渠道 {qoder}）', {
                      actual: routingActualLabel(routing, tr),
                      wb: routingPri.workbuddy,
                      qoder: routingPri.qoder,
                    }),
                  )
                : null,
              routing.available && routing.mode && routing.actualMode && routing.mode !== routing.actualMode
                ? h(
                    'div',
                    { className: 'wbcd-notice wbcd-bad' },
                    tr('routing.mismatch', '已选择「{mode}」，但实际优先级是「{actual}」，可能被其他进程改过。', {
                      mode:
                        routing.mode === 'qoder'
                          ? tr('routing.qoder', 'Qoder 优先')
                          : tr('routing.workbuddy', 'WorkBuddy 优先'),
                      actual: routingActualLabel(routing, tr),
                    }),
                  )
                : null,
              h('div', { className: 'wbcd-hint' }, tr('routing.hint', '优先平台 = 提高该平台在 new-api 里的渠道优先级；拥堵或报错时新请求会自动回退到另一平台。切换即时生效，只影响新请求。')),
            )
          : null,
        gateway && priceLine ? h('div', { className: 'wbcd-sub' }, h('span', null, tr('settings.price', '折算单价') + '：' + priceLine)) : null,
        notice ? h('div', { className: 'wbcd-notice wbcd-bad' }, notice) : null,
        h(
          'div',
          null,
          h('div', { className: 'wbcd-section-title' }, tr('settings.accounts', '账号')),
          gateway && gateway.online === false
            ? h('div', { className: 'wbcd-notice wbcd-bad' }, gateway.error || tr('dock.error', '网关未连接'))
            : null,
          qoder && qoder.enabled && qoder.online === false
            ? h('div', { className: 'wbcd-notice wbcd-bad' }, qoder.error || tr('qoder.offline', 'Qoder 网关未连接'))
            : null,
          accountRows.length === 0
            ? h('div', { className: 'wbcd-empty' }, tr('settings.empty', '暂无数据'))
            : h(
                'div',
                { className: 'wbcd-grid' },
                ...accountRows.map(({ account, source }) => renderAccountCard(account, source)),
              ),
        ),
        h(
          'div',
          null,
          h('div', { className: 'wbcd-section-title' }, tr('settings.recent', '最近对话')),
          recentError ? h('div', { className: 'wbcd-notice wbcd-bad' }, recentError) : null,
          recent && recent.supported === false
            ? h('div', { className: 'wbcd-empty' }, '当前 DSH 没有会话查询服务，无法列出历史对话')
            : recent && Array.isArray(recent.items) && recent.items.length > 0
              ? h(
                  'table',
                  { className: 'wbcd-table' },
                  h(
                    'thead',
                    null,
                    h(
                      'tr',
                      null,
                      h('th', null, '对话'),
                      h('th', { className: 'wbcd-num' }, tr('settings.turn', '轮次')),
                      h('th', { className: 'wbcd-num' }, tr('settings.tokens', 'tokens')),
                      h('th', { className: 'wbcd-num' }, tr('settings.credits', '≈积分')),
                      h('th', { className: 'wbcd-num' }, tr('settings.time', '时间')),
                    ),
                  ),
                  h(
                    'tbody',
                    null,
                    ...recent.items.map(item =>
                      h(
                        'tr',
                        { key: item.id },
                        h('td', { title: item.id }, item.title || item.id.slice(0, 8)),
                        h('td', { className: 'wbcd-num' }, String(item.turns)),
                        h('td', { className: 'wbcd-num' }, formatTokens(item.tokens)),
                        h('td', { className: 'wbcd-num' }, item.missingPrice ? '—' : '≈' + formatCredits(item.credits)),
                        h('td', { className: 'wbcd-num' }, shortTime(item.updatedAt)),
                      ),
                    ),
                  ),
                )
              : h('div', { className: 'wbcd-empty' }, tr('settings.empty', '暂无数据')),
        ),
        h(
          'div',
          null,
          h('div', { className: 'wbcd-section-title' }, tr('settings.current', '当前对话逐轮明细')),
          session && Array.isArray(session.turns) && session.turns.length > 0
            ? h(
                'table',
                { className: 'wbcd-table' },
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    h('th', { className: 'wbcd-num' }, tr('settings.turn', '轮次')),
                    h('th', { className: 'wbcd-num' }, tr('settings.tokens', 'tokens')),
                    h('th', { className: 'wbcd-num' }, tr('settings.credits', '≈积分')),
                    h('th', null, tr('settings.models', '模型')),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  ...session.turns.map(row =>
                    h(
                      'tr',
                      { key: String(row.turn) },
                      h('td', { className: 'wbcd-num' }, '#' + row.turn),
                      h('td', { className: 'wbcd-num' }, formatTokens(row.tokens)),
                      h('td', { className: 'wbcd-num' }, row.credits === null ? '—' : '≈' + formatCredits(row.credits)),
                      h('td', null, (row.models || []).map(trimModel).join(' / ') || '—'),
                    ),
                  ),
                  h(
                    'tr',
                    null,
                    h('td', null, '合计'),
                    h('td', { className: 'wbcd-num' }, formatTokens(session.totalTokens)),
                    h('td', { className: 'wbcd-num' }, '≈' + formatCredits(session.totalCredits)),
                    h('td', null, ''),
                  ),
                ),
              )
            : h('div', { className: 'wbcd-empty' }, tr('settings.empty', '暂无数据')),
        ),
        h('div', { className: 'wbcd-hint' }, tr('settings.hint', '积分按「网关实测单价」或「模型倍率折算」估算，上游限免时段实际扣费可能更低；签到状态来自一次幂等的签到调用。')),
      )
    })

    function shortenTime(iso) {
      const clock = formatClock(iso)
      if (!clock) return ''
      const date = new Date(iso)
      const now = new Date()
      if (date.toDateString() === now.toDateString()) return clock
      return (date.getMonth() + 1) + '/' + date.getDate()
    }

    // -----------------------------------------------------------------------
    // 注册
    // -----------------------------------------------------------------------

    function registerSlot(ctx, slot, options, component) {
      try {
        return ctx.slots.register(Object.assign({ name: slot }, options), component)
      } catch (error) {
        console.error('[free-egg-credits] register ' + slot + ' failed', error)
        // locale 选项在个别版本不可用时退回无语言包注册（组件自带中文回落）
        const fallback = Object.assign({}, options)
        delete fallback.locale
        try {
          return ctx.slots.register(Object.assign({ name: slot }, fallback), component)
        } catch (fallbackError) {
          console.error('[free-egg-credits] register ' + slot + ' fallback failed', fallbackError)
          return () => {}
        }
      }
    }

    function apply(ctx) {
      const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
      if (locale && typeof locale.register === 'function') {
        try {
          ctx.effect(() => {
            const offZh = locale.register(NS, 'zh', ZH)
            const offEn = locale.register(NS, 'en', EN)
            return () => {
              offZh()
              offEn()
            }
          })
          if (typeof locale.bind === 'function') boundTranslate = locale.bind(NS)
        } catch (error) {
          console.error('[free-egg-credits] locale registration failed', error)
        }
      }

      ctx.slots.inject('sidebar.footer.action', () =>
        registerSlot(
          ctx,
          'sidebar.footer.action',
          { id: 'free-egg-credits', order: 10, locale: NS },
          SidebarCredits,
        ),
      )

      ctx.slots.inject('conversation.composer.dock', () =>
        registerSlot(
          ctx,
          'conversation.composer.dock',
          { id: 'free-egg-credits', order: 2, locale: NS },
          DockStrip,
        ),
      )

      ctx.slots.inject('conversation.chat.turnTail', () =>
        registerSlot(
          ctx,
          'conversation.chat.turnTail',
          { id: 'free-egg-credits', order: 10, locale: NS },
          TurnCost,
        ),
      )

      ctx.slots.inject('settings.section', () =>
        registerSlot(
          ctx,
          'settings.section',
          {
            id: 'free-egg-credits',
            order: 16,
            locale: NS,
            label: () =>
              translateWith(null, 'section.title', 'Free Egg 积分'),
          },
          SettingsPage,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply,
    }
  },
})
