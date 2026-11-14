import {
  DEFAULT_CONFIG,
  addDays,
  computeDay,
  dateOf,
  dayStart,
  moodLabel,
  normalizeConfig,
  summaryText,
} from './model.js'
import { buildSnapshot } from './snapshot.js'
import { bootstrap } from './bootstrap.js'
import { lastCheckText, selfcheck, selfcheckText } from './selfcheck.js'
import { applyAllBridges, bridgeStatus, restoreAllBridges } from './bridge.js'
import { resolveDiaryTarget } from './diaryPath.js'
import { readDiaryText } from './diary.js'
import {
  bumpSalt,
  readConfig,
  writeConfig,
} from './store.js'

export const name = 'dsh-emotionalwhale'

const cache = new Map()

function zhOf(caps) {
  return !String(caps?.locale || 'zh').startsWith('en')
}

function monthDay(dateStr) {
  const [, m, d] = dateStr.split('-')
  return `${Number(m)} 月 ${Number(d)} 日`
}

const snapshot = () => buildSnapshot()

// 画曲线时按天回算：日子和刷没刷来自日记，后劲按半衰期自然衰减。
function series(s, days = 14) {
  const cats = []
  const values = []
  const decisions = Object.fromEntries(s.past.map((e) => [e.date, { watch: true }]))
  const entries = s.past.filter((e) => e.mood)
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(s.today, -i)
    const p = date === s.today
      ? s.day.probability
      : computeDay(date, { entries, decisions, override: {}, salt: {} }, s.cfg, { atMs: dayStart(date) + 12 * 3_600_000 }).probability
    cats.push(date.slice(5).replace('-', '/'))
    values.push(Math.round(p * 100))
  }
  return { cats, values }
}

function factorItems(day) {
  return day.factors
    .slice()
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6)
    .map((f) => ({
      title: f.label,
      subtitle: f.hint || '—',
      trailing: `${f.delta > 0 ? '+' : ''}${Math.round(f.delta * 100)}%`,
      tone: f.delta > 0 ? 'good' : f.delta < 0 ? 'bad' : 'muted',
    }))
}

function recentItems(entries, limit = 5) {
  return entries
    .filter((e) => e.mood)
    .slice(-limit)
    .reverse()
    .map((e) => ({
      title: `${moodLabel(e.mood)} · ${Math.round(e.intensity * 100)}%`,
      subtitle: e.note || e.date,
      trailing: e.date.slice(5).replace('-', '/'),
    }))
}

function trendRows(s, limit = 8, zh = true) {
  const decisions = Object.fromEntries(s.past.map((e) => [e.date, { watch: true }]))
  const byDate = Object.fromEntries(s.past.map((e) => [e.date, e]))
  const entries = s.past.filter((e) => e.mood)
  const rows = []
  for (let i = limit - 1; i >= 0; i--) {
    const date = addDays(s.today, -i)
    if (date === s.today) {
      rows.push([date.slice(5).replace('-', '/'), `${Math.round(s.day.probability * 100)}%`, s.day.watch ? (zh ? '刷' : 'W') : zh ? '不刷' : 'S'])
      continue
    }
    if (!byDate[date]) {
      rows.push([date.slice(5).replace('-', '/'), '—', '—'])
      continue
    }
    const p = computeDay(date, { entries, decisions, override: {}, salt: {} }, s.cfg, { atMs: dayStart(date) + 12 * 3_600_000 }).probability
    rows.push([date.slice(5).replace('-', '/'), `${Math.round(p * 100)}%`, zh ? '刷' : 'W'])
  }
  return rows
}

// ── 记忆面板 ───────────────────────────────────────────────────────────────
// 只读：不写日记 / 日志 / gate.json，不删、不衰减，也没有常驻定时器。
// 数据只在面板打开时算一次（snapshot 自带缓存）。

const DAY_MS = 24 * 60 * 60 * 1000
const BV_RE = /BV[0-9A-Za-z]{10}/g

function daysBetween(fromDate, toDate) {
  return Math.round((dayStart(toDate) - dayStart(fromDate)) / DAY_MS)
}

function dateFromHead(text) {
  const m = String(text || '').slice(0, 200).match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (!m) return null
  const [, y, mo, da] = m.map(Number)
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`
}

function dateFromFileName(name) {
  const m = String(name || '').match(/(20\d{2})[-_.年](\d{1,2})[-_.月](\d{1,2})/)
  if (!m) return null
  const [, y, mo, da] = m.map(Number)
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`
}

// 一次 split 把所有日期段切开，别为每段重读文件。
function diarySegments(raw) {
  const segments = []
  for (const chunk of raw?.chunks || []) {
    const fileDate = dateFromFileName(chunk.name)
    for (const part of String(chunk.text).split(/^## /m)) {
      if (!part.trim()) continue
      segments.push({ date: dateFromHead(part) || fileDate, text: part })
    }
  }
  return segments
}

function lastMentionDate(segments, re) {
  let latest = null
  for (const seg of segments) {
    if (!seg.date) continue
    re.lastIndex = 0
    if (!re.test(seg.text)) continue
    if (!latest || seg.date > latest) latest = seg.date
  }
  return latest
}

// 每个 BV 号最后一次被提起的日期
function bvLastDates(segments) {
  const map = new Map()
  for (const seg of segments) {
    if (!seg.date) continue
    const hits = String(seg.text).match(BV_RE) || []
    for (const bv of hits) {
      const prev = map.get(bv)
      if (!prev || seg.date > prev) map.set(bv, seg.date)
    }
  }
  return map
}

// 逐条显示：mood 为 null 也要出现，别再整条过滤掉
function memoryRecent(entries, zh = true) {
  return entries
    .slice(-5)
    .reverse()
    .map((e) => {
      const day = e.date.slice(5).replace('-', '/')
      if (e.mood) {
        return {
          title: `${day} · ${moodLabel(e.mood)} · ${Math.round(e.intensity * 100)}%`,
          subtitle: e.note || '—',
          trailing: zh ? '有情绪' : 'mood',
          tone: 'info',
        }
      }
      if (e.watched === false) {
        return {
          title: `${day} · ${zh ? '跳过日' : 'Skipped'}`,
          subtitle: e.note || (zh ? '这天写了不刷' : 'written as a skip day'),
          trailing: zh ? '跳过' : 'skip',
          tone: 'muted',
        }
      }
      if (e.path === 'activity') {
        return {
          title: `${day} · ${zh ? '有观看记录' : 'Activity'}`,
          subtitle: e.note || '—',
          trailing: zh ? '记录' : 'log',
          tone: 'muted',
        }
      }
      return {
        title: `${day} · ${zh ? '写了，没标情绪' : 'Written, no mood'}`,
        subtitle: e.note || '—',
        trailing: zh ? '无情绪' : 'no mood',
        tone: 'muted',
      }
    })
}

export function memoryData(zh = true) {
  // writeGate: false —— 只读面板不重写 gate.json
  const s = buildSnapshot(Date.now(), { writeGate: false })
  const { day, diary } = s
  const today = s.today
  const byDate = new Map()
  for (const e of diary.entries) byDate.set(e.date, e)

  // 近 30 天：有没有写，看条目；不看 mood
  const cats = []
  const values = []
  const moodValues = []
  let withMoodDays = 0
  for (let i = 29; i >= 0; i--) {
    const date = addDays(today, -i)
    const entry = byDate.get(date)
    cats.push(date.slice(5).replace('-', '/'))
    values.push(entry ? 1 : 0)
    const hasMood = Boolean(entry && entry.mood)
    moodValues.push(hasMood ? 1 : 0)
    if (hasMood) withMoodDays++
  }
  const recordedDays = values.reduce((a, b) => a + b, 0)
  // 一条记录都没有时，「距上次 30 天」是 gap 的默认兜底值，不是真的断了 30 天
  const hasRecords = diary.entries.length > 0

  // 遗忘预警：三个纯文本探针，全部只读
  const raw = readDiaryText(s.cfg)
  const segments = diarySegments(raw)

  const ownerDate = lastMentionDate(segments, /主人/)
  const ownerDays = ownerDate ? daysBetween(ownerDate, today) : null

  const bvs = [...bvLastDates(segments).entries()]
    .map(([bv, date]) => ({ bv, date, days: daysBetween(date, today) }))
    .sort((a, b) => b.days - a.days)

  const memory = []
  memory.push({
    title: zh ? '「主人」' : '"Owner"',
    subtitle: ownerDate
      ? zh ? `上次出现：${ownerDate.slice(5).replace('-', '/')}` : `Last seen ${ownerDate}`
      : zh ? '日记里还没出现过这个词' : 'Not mentioned in the diary yet',
    trailing: ownerDays === null ? '—' : zh ? `${ownerDays} 天前` : `${ownerDays}d ago`,
    tone: ownerDays !== null && ownerDays > 7 ? 'bad' : 'muted',
  })
  for (const item of bvs.slice(0, 3)) {
    memory.push({
      title: item.bv,
      subtitle: zh ? `上次提到：${item.date.slice(5).replace('-', '/')}` : `Last mentioned ${item.date}`,
      trailing: zh ? `${item.days} 天没提` : `${item.days}d`,
      tone: item.days > 14 ? 'bad' : 'muted',
    })
  }
  memory.push(
    hasRecords
      ? {
          title: zh ? '断更' : 'Gap',
          subtitle: zh ? `连更 ${day.streak} 天 · 距上次 ${day.gap} 天` : `Streak ${day.streak}d · gap ${day.gap}d`,
          trailing: zh ? `${day.gap} 天` : `${day.gap}d`,
          tone: day.gap >= 3 ? 'bad' : 'muted',
        }
      : {
          // 空数据不是「断了 30 天」，别报警
          title: zh ? '断更' : 'Gap',
          subtitle: zh ? '还没有记录' : 'No records yet',
          trailing: '—',
          tone: 'muted',
        },
  )

  const metrics = [
    {
      label: zh ? '连更' : 'Streak',
      value: zh ? `${day.streak} 天` : `${day.streak}d`,
      caption: zh ? '日记连续有记录' : 'consecutive days',
      tone: day.streak > 0 ? 'good' : 'muted',
    },
    {
      label: zh ? '距上次' : 'Gap',
      value: hasRecords ? (zh ? `${day.gap} 天` : `${day.gap}d`) : '—',
      caption: hasRecords ? (zh ? '距上次刷' : 'since last watch') : zh ? '还没有记录' : 'no records yet',
      tone: hasRecords && day.gap >= 3 ? 'bad' : 'muted',
    },
    {
      label: zh ? '有情绪的天数' : 'With mood',
      value: zh ? `${withMoodDays} 天` : `${withMoodDays}d`,
      caption: zh ? '近 30 天，靠正文关键词，可能漏' : 'last 30 days; keyword based',
      tone: 'info',
    },
  ]

  const allNoMood = diary.entries.length > 0 && diary.entries.every((e) => !e.mood)
  const readonlyNote = zh ? '只读面板：不写文件、不删、不自动衰减。' : 'Read-only: no writes, no deletion, no auto-decay.'
  let note = readonlyNote
  if (!diary.entries.length) {
    note = raw.found
      ? zh
        ? '文件在，但没解析出日期段 —— 每段要以 ## YYYY-MM-DD 开头。只读面板：不写文件、不删、不自动衰减。'
        : 'Diary files exist, but no dated sections were parsed; each section needs a ## YYYY-MM-DD heading.'
      : zh
        ? `没找到日记：${diary.path} —— 到「权重设置」里检查一下路径。`
        : `No diary at ${diary.path}; check the path in Weights.`
  } else if (allNoMood) {
    note = zh
      ? '这些天都没标情绪；补一行「心情：感动 · 强度 0.7」就会被算进来。只读面板：不写文件、不删、不自动衰减。'
      : 'No moods recorded yet; add a mood line to be counted. Read-only: no writes, no deletion, no auto-decay.'
  }

  const stats = [
    [zh ? '日记' : 'Diary', zh ? `${recordedDays} 天有记录` : `${recordedDays} days recorded`],
    [zh ? '有情绪' : 'With mood', zh ? `${withMoodDays} 天` : `${withMoodDays} days`],
    [zh ? '最新' : 'Latest', diary.latest?.date || (zh ? '没有' : 'none')],
    [zh ? '位置' : 'Path', diary.target?.ok ? diary.path : `${diary.path}${zh ? '（不可用）' : ' (unavailable)'}`],
  ]

  const data = {
    dateLabel: monthDay(today),
    headline: zh ? '记忆 · 近 30 天' : 'Memory · Last 30 days',
    metrics,
    cats,
    values,
    moodValues,
    memory: memory.slice(0, 5),
    recent: memoryRecent(diary.entries, zh),
    stats,
    note,
    streakText: metrics[0].value,
    gapText: metrics[1].value,
    moodDaysText: metrics[2].value,
  }
  cache.set('memory', data)
  return data
}

function dayData(zh = true) {
  const s = snapshot()
  const { day, diary } = s
  const chart = series(s)
  const diaryText = diary.latest
    ? `${diary.latest.date.slice(5).replace('-', '/')} · ${diary.latest.mood ? moodLabel(diary.latest.mood) : zh ? '没写情绪' : 'no mood'}`
    : diary.target?.created
      ? zh ? '没日记，目录已建好' : 'No diary yet; folder ready'
      : zh ? '没找到日记' : 'No diary found'
  const diaryStatus = diary.target?.fallback
    ? zh ? `原路径不可用，已退回：${diary.path}` : `Fell back to ${diary.path}`
    : diary.target?.created
      ? zh ? `已创建日记位置：${diary.path}` : `Created ${diary.path}`
      : diary.target?.ok
        ? zh ? `日记位置可用：${diary.path}` : `Ready: ${diary.path}`
        : zh ? `日记位置不可用：${diary.path}` : `Unavailable: ${diary.path}`
  const data = {
    dateLabel: monthDay(s.today),
    headline: zh ? `${monthDay(s.today)} · 今天刷不刷` : `Today · ${s.today}`,
    pct: `${Math.round(day.probability * 100)}%`,
    skipPct: `${Math.round(day.noWatchProbability * 100)}%`,
    bothPct: `${Math.round(day.probability * 100)}% / ${Math.round(day.noWatchProbability * 100)}%`,
    mood: day.topMood ? `${moodLabel(day.topMood.id)} ${Number(day.moodScore).toFixed(1)}` : zh ? '平稳' : 'Calm',
    summary: summaryText(day, zh),
    streak: zh ? `${day.streak} 天` : `${day.streak}d`,
    gap: zh ? `${day.gap} 天` : `${day.gap}d`,
    diaryText,
    diaryStatus,
    checkText: lastCheckText(zh),
    hostNote: zh ? '只改不刷概率' : 'skip chance only',
    hostCaption: zh ? '最终由 bili-whale 决定' : 'bili-whale decides',
    factors: factorItems(day),
    cats: chart.cats,
    values: chart.values,
    stats: [
      [zh ? '连刷' : 'Streak', zh ? `${day.streak} 天` : `${day.streak}d`],
      [zh ? '距上次' : 'Gap', zh ? `${day.gap} 天` : `${day.gap}d`],
      [zh ? '日记' : 'Diary', diaryText],
    ],
    recent: recentItems(s.past, 5),
  }
  cache.set('today', data)
  return data
}

export function apply(ctx) {
  try {
    bootstrap()
  } catch {}
  // 加载时自动自检一次，报告写 state/selfcheck.json（面板里直接看到上次结果）
  try {
    selfcheck()
  } catch {}
  // 自动维护：每 30 分钟补一次桥接（宿主升级覆盖后不用手动跑 --bridge）并刷新 gate
  try {
    const keep = setInterval(() => {
      try {
        applyAllBridges()
        buildSnapshot()
      } catch {}
    }, 30 * 60_000)
    if (typeof keep?.unref === 'function') keep.unref() // 不让定时器拖住 CLI / 检查器退出
    if (typeof ctx?.on === 'function')
      ctx.on('dispose', () => {
        clearInterval(keep)
        // 卸载/停用本插件时，把养鱼宿主还原回打补丁前，别让它们跟着坏掉
        try {
          restoreAllBridges()
        } catch {}
      })
  } catch {}
  ctx.inject(['dshGo'], (ctx) => {
    const strip = (scope, emit, caps) => {
      const zh = zhOf(caps)
      const tick = () => {
        try {
          const { day } = snapshot()
          emit({
            text: zh
              ? `今天不刷概率 ${Math.round(day.noWatchProbability * 100)}% · 想看概率 ${Math.round(day.probability * 100)}% · 最终看 bili-whale`
              : `Skip chance ${Math.round(day.noWatchProbability * 100)}% · watch ${Math.round(day.probability * 100)}% · bili-whale decides`,
            icon: 'heart',
            tone: 'muted',
          })
        } catch {
          emit({ text: zh ? '今天：算不出来' : 'Today: n/a', icon: 'heart', tone: 'muted' })
        }
      }
      tick()
      const timer = setInterval(tick, 30 * 60_000)
      return () => clearInterval(timer)
    }

    ctx.dshGo.strip('gate', strip)

    ctx.dshGo.panel('today', {
      view: (scope, caps) => {
        const zh = zhOf(caps)
        return {
          v: 2,
          type: 'stack',
          accent: 'teal',
          title: zh ? '今天刷不刷' : 'Today',
          children: [
            { type: 'text', text: { $: 'data.headline' }, style: { size: 'title', weight: 'bold' } },
            {
              type: 'row',
              children: [
                { type: 'metric', label: zh ? '想刷 / 不刷' : 'Watch / Skip', value: { $: 'data.bothPct' }, tone: 'info' },
                { type: 'metric', label: zh ? '对 bili-whale' : 'For bili-whale', value: { $: 'data.hostNote' }, caption: { $: 'data.hostCaption' } },
                { type: 'metric', label: zh ? '后劲' : 'Mood', value: { $: 'data.mood' } },
              ],
            },
            { type: 'callout', text: { $: 'data.summary' }, tone: 'info' },
            { type: 'callout', text: zh ? '这里只算「不刷概率」，不替 bili-whale 做最终决定；它当天凌晨已经定好刷不刷、什么时候刷。' : 'This only sets the skip chance; bili-whale already decides whether and when to watch at midnight.', tone: 'info' },
            { type: 'text', text: zh ? '为什么是这个数' : 'Why this number', style: { size: 'subtitle', weight: 'semibold' } },
            { type: 'list', items: { $: 'data.factors' } },
            { type: 'chart', kind: 'line', categories: { $: 'data.cats' }, series: [{ name: zh ? '想刷概率' : 'Chance', values: { $: 'data.values' } }], unit: '%', caption: zh ? '近 14 天' : 'Last 14 days' },
            { type: 'keyValue', items: { $: 'data.stats' } },
            { type: 'callout', text: { $: 'data.checkText' }, tone: 'info' },
            {
              type: 'actions',
              items: [
                { label: zh ? '重掷参考' : 'Reroll', action: 'reroll' },
                { label: zh ? '自检' : 'Check', action: 'selfcheck', style: 'plain' },
              ],
            },
          ],
        }
      },
      data: (scope, emit, caps) => {
        emit(dayData(zhOf(caps)))
        return () => {}
      },
      actions: {
        reroll: (scope, event) => {
          const zh = zhOf(event)
          try {
            bumpSalt(dateOf(Date.now()))
            const g = snapshot().gate
            const p1 = (n) => (Math.round(n * 1000) / 10).toFixed(1)
            const pct = p1(g.probability)
            const linePct = p1(g.watchChance ?? g.probability)
            const rollPct = p1(g.roll)
            return {
              refresh: true,
              toast: zh
                ? `重掷了：想刷 ${pct}%，骰子 ${rollPct}% ${g.watch ? '<' : '≥'} 判定线 ${linePct}%，本插件参考偏${g.watch ? '刷' : '不刷'}；宿主仍按凌晨的决策`
                : `Rerolled: want ${pct}%, dice ${rollPct}% ${g.watch ? '<' : '≥'} line ${linePct}%, leans ${g.watch ? 'watch' : 'skip'}; host keeps its midnight decision`,
            }
          } catch {
            return { toast: zh ? '重掷失败' : 'Reroll failed' }
          }
        },
        selfcheck: (scope, event) => {
          const zh = zhOf(event)
          try {
            const r = selfcheck()
            return { refresh: true, toast: selfcheckText(r, zh) }
          } catch (error) {
            return { toast: zh ? '自检跑不起来' : 'Check failed' }
          }
        },
      },
    })

    ctx.dshGo.panel('weights', {
      view: (scope, caps) => {
        const zh = zhOf(caps)
        const slider = (label, bind, min, max, step) => ({ type: 'slider', label, bind, min, max, step })
        return {
          v: 2,
          type: 'stack',
          accent: 'indigo',
          title: zh ? '权重' : 'Weights',
          children: [
            { type: 'text', text: zh ? '概率都是 0–1。改完点保存，今天的概率立刻重算。' : 'All values are 0–1. Save to recompute.', tone: 'muted' },
            { type: 'metric', label: zh ? '当前想刷' : 'Current chance', value: { $: 'data.pct' }, tone: 'info' },
            {
              type: 'form',
              submit: { id: 'save-weights' },
              submitLabel: zh ? '保存并重算' : 'Save',
              children: [
                { type: 'textField', label: zh ? '日记位置' : 'Diary path', bind: 'data.cfg.diaryPath', placeholder: zh ? '留空自动找，或填目录/文件' : 'Empty = auto', maxLength: 200 },
                slider(zh ? '基础意愿' : 'Base', 'data.cfg.base', 0.1, 0.95, 0.01),
                slider(zh ? '后劲权重' : 'Afterglow', 'data.cfg.wAfterglow', 0, 0.9, 0.01),
                slider(zh ? '连刷的腻' : 'Fatigue', 'data.cfg.wFatigue', 0, 0.6, 0.01),
                slider(zh ? '断更回弹' : 'Return', 'data.cfg.wReturn', 0, 0.6, 0.01),
                slider(zh ? '周末加成' : 'Weekend', 'data.cfg.wWeekend', 0, 0.3, 0.01),
                slider(zh ? '每日浮动' : 'Jitter', 'data.cfg.wJitter', 0, 0.3, 0.01),
                slider(zh ? '骰子权重' : 'Dice weight', 'data.cfg.diceWeight', 0, 1, 0.01),
                slider(zh ? '后劲半衰期（小时）' : 'Half-life (h)', 'data.cfg.halfLifeHours', 2, 72, 1),
                slider(zh ? '后劲压缩尺度' : 'Mood scale', 'data.cfg.moodScale', 0.5, 6, 0.1),
                slider(zh ? '概率下限' : 'Floor', 'data.cfg.floor', 0, 0.45, 0.01),
                slider(zh ? '概率上限' : 'Ceiling', 'data.cfg.ceiling', 0.55, 1, 0.01),
              ],
            },
            { type: 'callout', text: { $: 'data.diaryStatus' }, tone: 'info' },
            { type: 'callout', text: { $: 'data.bridgeText' }, tone: 'good' },
            { type: 'callout', text: zh ? '日记只读不写；连刷和断更也来自日记日期，所以不需要另外记一份历史。' : 'Diary is read-only; history comes from its dates.', tone: 'info' },
            { type: 'text', text: zh ? '最近的日记' : 'Recent diary', style: { size: 'subtitle', weight: 'semibold' } },
            { type: 'list', items: { $: 'data.recent' } },
          ],
        }
      },
      data: (scope, emit, caps) => {
        const zh = zhOf(caps)
        const s = snapshot()
        const data = {
          cfg: { ...s.cfg },
          pct: `${Math.round(s.day.probability * 100)}%`,
          recent: recentItems(s.past, 6),
          diaryStatus: s.diary.target?.fallback
            ? `已退回：${s.diary.path}`
            : s.diary.target?.created
              ? `已创建：${s.diary.path}`
              : s.diary.target?.ok
                ? `可用：${s.diary.path}`
                : `不可用：${s.diary.path}`,
          bridgeText: (() => {
            const bs = bridgeStatus()
            if (!bs.installed) return zh ? '宿主桥接：没找到 B 站养鱼插件，先用默认概率' : 'Bridge: no host plugin found'
            const ok = bs.hosts.filter((h) => h.bridged)
            const pending = bs.hosts.filter((h) => h.supported && !h.bridged)
            const names = (list) => list.map((h) => h.name).join('、')
            if (pending.length) return zh ? `宿主桥接：还没打上（${names(pending)}），下次启动自动重试` : `Bridge: not applied (${names(pending)})`
            if (ok.length) {
              const extra = bs.unsupported ? (zh ? `；另有 ${bs.unsupported} 个插件没有总闸门` : `; ${bs.unsupported} unsupported`) : ''
              return zh ? `宿主桥接：已接管 ${ok.length} 个（${names(ok)}）${extra}` : `Bridge: ${ok.length} host(s) bridged (${names(ok)})${extra}`
            }
            return zh ? '宿主桥接：没有识别出可接的闸门' : 'Bridge: no compatible gate'
          })(),
        }
        cache.set('weights', data)
        emit(data)
        return () => {}
      },
      actions: {
        'save-weights': (scope, event) => {
          const zh = zhOf(event)
          const payload = event?.value
          const cached = cache.get('weights')
          const raw = { diaryPath: pick(payload, 'diaryPath') ?? cached?.cfg?.diaryPath ?? '' }
          for (const key of Object.keys(DEFAULT_CONFIG)) {
            if (key === 'diaryPath') continue
            const v = pick(payload, key)
            raw[key] = Number.isFinite(Number(v)) ? Number(v) : cached?.cfg?.[key]
          }
          try {
            const next = normalizeConfig(raw)
            writeConfig(next)
            const target = resolveDiaryTarget(next)
            const note = target.created ? (zh ? '目录已创建' : 'folder created') : target.fallback ? (zh ? '路径不可用，已退回' : 'fell back') : zh ? '路径可用' : 'path ready'
            return { refresh: true, toast: zh ? `存好了，${note}` : `Saved; ${note}` }
          } catch {
            return { toast: zh ? '没存上' : 'Not saved' }
          }
        },
      },
    })

    ctx.dshGo.panel('trend', {
      view: (scope, caps) => {
        const zh = zhOf(caps)
        return {
          v: 2,
          type: 'stack',
          accent: 'green',
          title: zh ? '这阵子' : 'Trend',
          children: [
            { type: 'chart', kind: 'bar', categories: { $: 'data.cats' }, series: [{ name: zh ? '想刷概率' : 'Chance', values: { $: 'data.values' } }], unit: '%', caption: zh ? '近 14 天' : 'Last 14 days' },
            { type: 'table', columns: [zh ? '日期' : 'Date', zh ? '想刷' : 'Chance', zh ? '结果' : 'Result'], rows: { $: 'data.rows' } },
            { type: 'text', text: zh ? '日记里的后劲' : 'Moods in diary', style: { size: 'subtitle', weight: 'semibold' } },
            { type: 'list', items: { $: 'data.recent' } },
          ],
        }
      },
      data: (scope, emit, caps) => {
        const zh = zhOf(caps)
        const s = snapshot()
        const chart = series(s)
        const data = { cats: chart.cats, values: chart.values, rows: trendRows(s, 8, zh), recent: recentItems(s.past, 5) }
        cache.set('trend', data)
        emit(data)
        return () => {}
      },
    })

    // 第 4 个面板：记忆。只读、无按钮、无定时器，打开时算一次。
    ctx.dshGo.panel('memory', {
      view: (scope, caps) => {
        const zh = zhOf(caps)
        return {
          v: 2,
          type: 'stack',
          accent: 'teal',
          title: zh ? '记忆' : 'Memory',
          children: [
            { type: 'text', text: { $: 'data.headline' }, style: { size: 'title', weight: 'bold' } },
            {
              type: 'row',
              children: [
                { type: 'metric', label: zh ? '连更' : 'Streak', value: { $: 'data.streakText' }, caption: zh ? '日记连续有记录' : 'consecutive days', tone: 'good' },
                { type: 'metric', label: zh ? '距上次' : 'Gap', value: { $: 'data.gapText' }, caption: zh ? '距上次刷' : 'since last watch' },
                { type: 'metric', label: zh ? '有情绪的天数' : 'With mood', value: { $: 'data.moodDaysText' }, caption: zh ? '近 30 天' : 'last 30 days', tone: 'info' },
              ],
            },
            {
              type: 'chart',
              kind: 'bar',
              categories: { $: 'data.cats' },
              series: [
                { name: zh ? '写了' : 'Recorded', values: { $: 'data.values' } },
                { name: zh ? '有情绪' : 'With mood', values: { $: 'data.moodValues' } },
              ],
              unit: zh ? '天' : 'days',
              caption: zh ? '近 30 天；情绪靠正文关键词，可能漏' : 'Last 30 days; moods are keyword based',
            },
            { type: 'text', text: zh ? '快想不起来了' : 'Fading', style: { size: 'subtitle', weight: 'semibold' } },
            { type: 'list', items: { $: 'data.memory' } },
            { type: 'text', text: zh ? '这阵子' : 'Recently', style: { size: 'subtitle', weight: 'semibold' } },
            { type: 'list', items: { $: 'data.recent' } },
            { type: 'keyValue', items: { $: 'data.stats' } },
            { type: 'callout', text: { $: 'data.note' }, tone: 'info' },
          ],
        }
      },
      data: (scope, emit, caps) => {
        emit(memoryData(zhOf(caps)))
        return () => {}
      },
    })
  })
}

// 表单提交时 App 回传的结构不固定（可能整份 data、可能只有改动字段），
// 就在对象里按字段名广度找一下，找不到再用上一次 emit 的缓存。
function pick(root, key) {
  if (!root || typeof root !== 'object') return undefined
  const queue = [root]
  let guard = 0
  while (queue.length > 0 && guard++ < 60) {
    const item = queue.shift()
    if (!item || typeof item !== 'object') continue
    if (Object.prototype.hasOwnProperty.call(item, key)) {
      const v = item[key]
      if (v !== undefined && v !== null && typeof v !== 'object') return v
    }
    for (const v of Object.values(item)) {
      if (v && typeof v === 'object') queue.push(v)
    }
  }
  return undefined
}
