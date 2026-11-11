// 情感鲸鱼：把「今天刷不刷视频」从固定概率改成一套可解释的动态权重。
//
// 约定：所有概率都是 0–1 的小数，1 = 100%。宿主直接拿去比较，不用再除 100。
//
// 设计原则：
// 1. 概率永远可解释：每一项都算成一个小数，界面上折成百分比显示。
// 2. 后劲会衰减：今天刷到伤感，明天最重，之后按半衰期慢慢散掉。
// 3. 后劲不做硬封顶：多项叠加用 tanh 平滑压缩，越极端越接近权重上限，但不会突然截断。
// 4. 同一个日期内结果稳定：掷骰子用日期做种子；想改可以「重掷」。

export const MOODS = [
  { id: 'sad', label: '伤感', valence: -2 },
  { id: 'emo', label: 'emo', valence: -1.8 },
  { id: 'angry', label: '生气', valence: -1.5 },
  { id: 'scared', label: '后怕', valence: -1 },
  { id: 'flat', label: '平淡', valence: -0.4 },
  { id: 'healed', label: '治愈', valence: 1.4 },
  { id: 'moved', label: '感动', valence: 1.2 },
  { id: 'happy', label: '开心', valence: 1 },
  { id: 'hooked', label: '上头', valence: 1.8 },
]

export const MOOD_BY_ID = Object.fromEntries(MOODS.map((m) => [m.id, m]))

export const DEFAULT_CONFIG = {
  diaryPath: '', // bili-whale 写日记的目录或文件；留空则自动找几个常见位置
  base: 0.58, // 基础想刷概率，0.58 = 58%
  wAfterglow: 0.45, // 后劲最多能加减多少
  wFatigue: 0.2, // 连刷的腻
  wReturn: 0.15, // 断更的回弹
  wWeekend: 0.06, // 周末加成
  wJitter: 0.1, // 每日扰动幅度
  diceWeight: 0.2, // 骰子权重：1=完全按概率掷骰，0=过半就按多数，默认 0.2 让概率更主导
  halfLifeHours: 18, // 后劲半衰期
  moodScale: 2, // 后劲平滑压缩的尺度：分数到 2 时约发挥 76%
  floor: 0.08, // 想刷概率下限
  ceiling: 0.96, // 想刷概率上限
}

export const CONFIG_RANGES = {
  base: [0.1, 0.95],
  wAfterglow: [0, 0.9],
  wFatigue: [0, 0.6],
  wReturn: [0, 0.6],
  wWeekend: [0, 0.3],
  wJitter: [0, 0.3],
  diceWeight: [0, 1],
  halfLifeHours: [2, 72],
  moodScale: [0.5, 6],
  floor: [0, 0.45],
  ceiling: [0.55, 1],
}

const DAY_MS = 24 * 60 * 60 * 1000

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

const round2 = (n) => Math.round(n * 100) / 100

export function normalizeConfig(raw) {
  const out = { ...DEFAULT_CONFIG }
  if (!raw || typeof raw !== 'object') return out
  if (typeof raw.diaryPath === 'string') out.diaryPath = raw.diaryPath.trim().slice(0, 400)
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (key === 'diaryPath') continue
    const n = Number(raw[key])
    if (!Number.isFinite(n)) continue
    const [lo, hi] = CONFIG_RANGES[key]
    const v = clamp(n, lo, hi)
    if (key === 'halfLifeHours') out[key] = Math.round(v * 10) / 10
    else out[key] = round2(v)
  }
  if (out.ceiling - out.floor < 0.05) out.ceiling = Math.min(1, round2(out.floor + 0.05))
  return out
}

export function dateOf(ms) {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function dayStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

export function addDays(dateStr, n) {
  const t = dayStart(dateStr) + n * DAY_MS
  return dateOf(t + DAY_MS / 2) // 避开夏令时边界
}

function hash32(str) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

function seededUnit(seed) {
  let a = hash32(seed)
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function moodLabel(id) {
  return MOOD_BY_ID[id] ? MOOD_BY_ID[id].label : '说不上来'
}

export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const mood = MOOD_BY_ID[raw.mood] ? raw.mood : 'flat'
  const intensityRaw = Number(raw.intensity)
  const intensity = Number.isFinite(intensityRaw)
    ? intensityRaw > 1
      ? clamp(intensityRaw / 100, 0, 1)
      : clamp(intensityRaw, 0, 1)
    : 0.6
  const ts = Number(raw.ts)
  const when = Number.isFinite(ts) && ts > 0 ? ts : Date.now()
  return {
    id: String(raw.id || `m_${when.toString(36)}_${Math.random().toString(36).slice(2, 6)}`),
    ts: when,
    date: raw.date && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : dateOf(when),
    mood,
    intensity,
    note: typeof raw.note === 'string' ? raw.note.slice(0, 120) : '',
    source: raw.source === 'host' ? 'host' : 'manual',
  }
}

// 后劲分数：正数让明天更想刷，负数让明天更不想刷。
// 不设硬上限：分数可以继续累加，真正的影响由 computeDay 里的 tanh 平滑压缩。
export function afterglowScore(entries, atMs, cfg) {
  let score = 0
  for (const e of entries) {
    const ageH = (atMs - e.ts) / 3_600_000
    if (!(ageH >= 0) || ageH > 24 * 21) continue
    const mood = MOOD_BY_ID[e.mood] || MOOD_BY_ID.flat
    score += mood.valence * e.intensity * Math.pow(0.5, ageH / cfg.halfLifeHours)
  }
  return score
}

function watchedDays(state) {
  const set = new Set()
  for (const [date, d] of Object.entries(state.decisions || {})) {
    if (d && d.watch === true) set.add(date)
  }
  return set
}

function streakAt(dateStr, state, todaysWatch) {
  const set = watchedDays(state)
  let streak = todaysWatch ? 1 : 0
  let cur = addDays(dateStr, -1)
  for (let i = 0; i < 60; i++) {
    if (!set.has(cur)) break
    streak++
    cur = addDays(cur, -1)
  }
  return streak
}

function gapInfo(dateStr, state) {
  const set = watchedDays(state)
  let cur = addDays(dateStr, -1)
  let gap = 30
  for (let i = 1; i <= 30; i++) {
    if (set.has(cur)) {
      gap = i
      break
    }
    cur = addDays(cur, -1)
  }
  // 「因为后劲没缓过来而不看」的日子不算憋久了；只有普通休息日才算回弹
  let moodPauseDays = 0
  let day = addDays(dateStr, -1)
  for (let i = 1; i < gap; i++) {
    const decision = state.decisions?.[day]
    if (decision && decision.watch !== true && decision.moodPause) moodPauseDays++
    day = addDays(day, -1)
  }
  return { gap, moodPauseDays, returnGap: Math.max(0, gap - moodPauseDays) }
}

function weekendAt(dateStr) {
  const day = new Date(dayStart(dateStr)).getDay()
  return day === 0 || day === 6
}

/**
 * 计算某一天的想刷概率与结论（全部 0–1）。
 * @param {string} dateStr YYYY-MM-DD
 * @param {object} state { entries, decisions, override, salt, ... }
 * @param {object} cfg 归一化后的配置
 * @param {object} opts { atMs, salt }
 */
export function computeDay(dateStr, state, cfg, opts = {}) {
  const atMs = Number.isFinite(opts.atMs) ? opts.atMs : Date.now()
  const salt = Number.isFinite(opts.salt) ? opts.salt : Number(state.salt?.[dateStr] || 0)
  const entries = (state.entries || []).map(normalizeEntry).filter(Boolean)
  const prevOverride = state.override?.[dateStr] || null

  const moodScore = afterglowScore(entries, atMs, cfg)
  // 平滑压缩：分数越大越接近 wAfterglow，但永远不会「啪」地截断。
  const afterglow = cfg.wAfterglow * Math.tanh(moodScore / cfg.moodScale)

  // 腻烦来自「今天之前已经连刷了几天」，不把今天自己算进去。
  const gapInfoValue = gapInfo(dateStr, state)
  const gap = gapInfoValue.gap
  const returnGap = gapInfoValue.returnGap
  const moodPauseDays = gapInfoValue.moodPauseDays
  const weekend = weekendAt(dateStr)
  const jitter = (seededUnit(`${dateStr}#${salt}`) - 0.5) * 2 * cfg.wJitter
  const priorStreak = streakAt(dateStr, state, false)

  const baseParts = {
    base: cfg.base,
    afterglow,
    return: cfg.wReturn * Math.min(1, returnGap / 7),
    weekend: weekend ? cfg.wWeekend : 0,
    jitter,
  }
  const fatigue = -cfg.wFatigue * Math.min(1, priorStreak / 4)

  const parts = { ...baseParts, fatigue }
  const raw = parts.base + parts.afterglow + parts.fatigue + parts.return + parts.weekend + parts.jitter
  const modelProbability = clamp(raw, cfg.floor, cfg.ceiling)
  const forced = prevOverride === 'watch' || prevOverride === 'skip'
  // 强制时连概率一起定死：宿主（bili-whale 等）读的是 gate 的 noWatchProbability，
  // 只改 watch 字段拦不住它 —— 它会按原概率自己再掷一次骰子。
  const probability = forced ? (prevOverride === 'watch' ? 1 : 0) : modelProbability
  const roll = seededUnit(`${dateStr}#${salt}#roll`)
  // 骰子权重：1 时滚到哪算哪；0 时完全按“过半”决定。
  // 默认 0.2 表示概率主导 80%，骰子只在概率附近做小幅扰动。
  const majority = probability >= 0.5 ? 1 : 0
  const watchChance = majority + (probability - majority) * cfg.diceWeight
  const autoWatch = roll < watchChance
  const watch = forced ? prevOverride === 'watch' : autoWatch
  // gate 里的 streak 只算「今天之前」连续刷了几天，避免把还没发生的今天算进去
  const streak = priorStreak

  const factors = []
  const push = (key, label, delta, hint) => {
    if (Math.abs(delta) < 0.005) return
    factors.push({ key, label, delta: round2(delta), hint })
  }
  push('base', '基础状态', parts.base, '你平时的默认意愿')
  const topMood = dominantMood(entries, atMs)
  if (topMood) {
    push(
      'afterglow',
      `后劲·${topMood.label}`,
      parts.afterglow,
      parts.afterglow < 0 ? '还没散，压低了今天的意愿' : '还在回味，抬高了今天的意愿',
    )
  } else {
    push('afterglow', '后劲', parts.afterglow, '最近没记后劲')
  }
  push('fatigue', '连着刷', parts.fatigue, streak > 0 ? `已经连了 ${streak} 天` : '')
  push('return', '憋了几天', parts.return, moodPauseDays ? `距上次 ${gap} 天，其中 ${moodPauseDays} 天在缓后劲，不算憋` : gap >= 7 ? '隔了一周以上，有点想' : `距上次 ${gap} 天`)
  push('weekend', '周末', parts.weekend, '休息日多一点空闲')
  push('jitter', '今天的心情浮动', parts.jitter, '每天都会有点不一样')

  const reasons = factors
    .filter((f) => f.key !== 'base')
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3)

  return {
    date: dateStr,
    probability,
    modelProbability,
    noWatchProbability: 1 - probability,
    watchChance,
    roll,
    watch,
    forced,
    override: prevOverride,
    streak,
    gap,
    returnGap,
    moodPauseDays,
    moodScore,
    factors,
    reasons,
    topMood,
    autoWatch,
    cfg,
  }
}

function dominantMood(entries, atMs) {
  let best = null
  let weight = 0
  for (const e of entries) {
    const ageH = (atMs - e.ts) / 3_600_000
    if (!(ageH >= 0) || ageH > 24 * 14) continue
    const decayed = e.intensity * Math.pow(0.5, ageH / 18)
    if (decayed > weight) {
      weight = decayed
      best = MOOD_BY_ID[e.mood] || null
    }
  }
  return best && weight > 0.05 ? best : null
}

export function verdictText(day, zh = true) {
  if (day.forced) return day.override === 'watch' ? (zh ? '刷（你定的）' : 'Watch (forced)') : zh ? '不刷（你定的）' : 'Skip (forced)'
  return day.watch ? (zh ? '刷' : 'Watch') : zh ? '不刷' : 'Skip'
}

export function summaryText(day, zh = true) {
  if (day.forced) return day.override === 'watch' ? (zh ? '今天你手动定了：刷。' : 'You forced a watch day.') : zh ? '今天你手动定了：不刷。' : 'You forced a skip day.'
  if (day.probability < 0.3) return zh ? '后劲还没散，今天大概率不想刷。' : 'Still carrying the mood; likely skip today.'
  if (day.probability > 0.7) return zh ? '状态回来了，今天挺想刷。' : 'Mood is back; likely watch today.'
  if (Number.isFinite(day.roll)) {
    const p1 = (n) => (Math.round(n * 1000) / 10).toFixed(1)
    const pct = p1(day.probability)
    const linePct = p1(day.watchChance ?? day.probability)
    const rollPct = p1(day.roll)
    if (zh) {
      return day.watch
        ? `今天在犹豫（想刷 ${pct}%），骰子 ${rollPct}% < 判定线 ${linePct}%，这次中了，所以刷。`
        : `今天在犹豫（想刷 ${pct}%），骰子 ${rollPct}% ≥ 判定线 ${linePct}%，这次没中，所以不刷。`
    }
    return day.watch
      ? `On the fence (want ${pct}%); dice ${rollPct}% < line ${linePct}%, so watch.`
      : `On the fence (want ${pct}%); dice ${rollPct}% ≥ line ${linePct}%, so skip.`
  }
  return zh ? '今天在犹豫，掷骰子替你定了。' : 'On the fence today; the dice decided.'
}

// 把某天之前的记录裁掉，避免状态文件越长越大。
export function pruneState(state, keepDays = 90) {
  const cutoff = addDays(dateOf(Date.now()), -keepDays)
  state.entries = (state.entries || []).filter((e) => e.date >= cutoff)
  const decisions = {}
  for (const [d, v] of Object.entries(state.decisions || {})) if (d >= cutoff) decisions[d] = v
  state.decisions = decisions
  return state
}
