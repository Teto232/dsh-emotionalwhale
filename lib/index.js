import {
  DEFAULT_CONFIG,
  addDays,
  computeDay,
  dateOf,
  dayStart,
  moodLabel,
  normalizeConfig,
  summaryText,
  verdictText,
} from './model.js'
import { buildSnapshot } from './snapshot.js'
import { bootstrap } from './bootstrap.js'
import { lastCheckText, selfcheck, selfcheckText } from './selfcheck.js'
import { applyAllBridges, bridgeStatus, restoreAllBridges } from './bridge.js'
import { resolveDiaryTarget } from './diaryPath.js'
import {
  bumpSalt,
  readConfig,
  setOverride,
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
    verdict: verdictText(day, zh),
    mood: day.topMood ? `${moodLabel(day.topMood.id)} ${Number(day.moodScore).toFixed(1)}` : zh ? '平稳' : 'Calm',
    summary: summaryText(day, zh),
    streak: zh ? `${day.streak} 天` : `${day.streak}d`,
    gap: zh ? `${day.gap} 天` : `${day.gap}d`,
    diaryText,
    diaryStatus,
    checkText: lastCheckText(zh),
    hasOverride: day.forced,
    overrideLabel: day.forced ? (day.override === 'watch' ? (zh ? '强制刷' : 'Forced watch') : zh ? '强制不刷' : 'Forced skip') : zh ? '没插手' : 'Auto',
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
              ? `今天：${day.watch ? '刷' : '不刷'} · 想刷${Math.round(day.probability * 100)}% / 不刷${Math.round(day.noWatchProbability * 100)}%`
              : `Today: ${day.watch ? 'watch' : 'skip'} · watch ${Math.round(day.probability * 100)}% / skip ${Math.round(day.noWatchProbability * 100)}%`,
            icon: 'heart',
            tone: day.watch ? 'good' : 'muted',
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
                { type: 'metric', label: zh ? '结论' : 'Verdict', value: { $: 'data.verdict' }, caption: { $: 'data.overrideLabel' } },
                { type: 'metric', label: zh ? '后劲' : 'Mood', value: { $: 'data.mood' } },
              ],
            },
            { type: 'callout', text: { $: 'data.summary' }, tone: 'info' },
            { type: 'text', text: zh ? '为什么是这个数' : 'Why this number', style: { size: 'subtitle', weight: 'semibold' } },
            { type: 'list', items: { $: 'data.factors' } },
            { type: 'chart', kind: 'line', categories: { $: 'data.cats' }, series: [{ name: zh ? '想刷概率' : 'Chance', values: { $: 'data.values' } }], unit: '%', caption: zh ? '近 14 天' : 'Last 14 days' },
            { type: 'keyValue', items: { $: 'data.stats' } },
            { type: 'callout', text: { $: 'data.checkText' }, tone: 'info' },
            {
              type: 'actions',
              items: [
                { label: zh ? '重掷今天' : 'Reroll', action: 'reroll' },
                { label: zh ? '今天刷' : 'Watch', action: 'force-watch' },
                { label: zh ? '今天不刷' : 'Skip', action: 'force-skip' },
                { label: zh ? '取消强制' : 'Auto', action: 'clear-force', style: 'plain' },
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
            if (g.forced) {
              return { refresh: true, toast: zh ? '今天已手动定了，重掷不改变结论' : 'Forced today; reroll does not change it' }
            }
            const p1 = (n) => (Math.round(n * 1000) / 10).toFixed(1)
            const pct = p1(g.probability)
            const linePct = p1(g.watchChance ?? g.probability)
            const rollPct = p1(g.roll)
            return {
              refresh: true,
              toast: zh
                ? `重掷了：想刷 ${pct}%，骰子 ${rollPct}% ${g.watch ? '<' : '≥'} 判定线 ${linePct}%，${g.watch ? '这次中了，所以刷' : '这次没中，所以不刷'}`
                : `Rerolled: want ${pct}%, dice ${rollPct}% ${g.watch ? '<' : '≥'} line ${linePct}%, ${g.watch ? 'watch' : 'skip'}`,
            }
          } catch {
            return { toast: zh ? '重掷失败' : 'Reroll failed' }
          }
        },
        'force-watch': (scope, event) => {
          const zh = zhOf(event)
          try {
            setOverride(dateOf(Date.now()), 'watch')
            return { refresh: true, toast: zh ? '今天定了：刷' : 'Forced watch' }
          } catch {
            return { toast: zh ? '没记上' : 'Not saved' }
          }
        },
        'force-skip': (scope, event) => {
          const zh = zhOf(event)
          try {
            setOverride(dateOf(Date.now()), 'skip')
            return { refresh: true, toast: zh ? '今天定了：不刷' : 'Forced skip' }
          } catch {
            return { toast: zh ? '没记上' : 'Not saved' }
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
        'clear-force': (scope, event) => {
          const zh = zhOf(event)
          try {
            setOverride(dateOf(Date.now()), null)
            return { refresh: true, toast: zh ? '交回给权重' : 'Back to auto' }
          } catch {
            return { toast: zh ? '没改上' : 'Not saved' }
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
