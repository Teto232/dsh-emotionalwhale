import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, addDays, computeDay, normalizeConfig, verdictText } from '../lib/model.js'

const DATE = '2026-11-09'
const AT = new Date(2026, 10, 9, 9, 0, 0).getTime()
const CFG = normalizeConfig(DEFAULT_CONFIG)

function state(entries = [], decisions = {}, extra = {}) {
  return { entries, decisions, override: {}, salt: {}, ...extra }
}

function entry(mood, intensity, hoursAgo, date = DATE) {
  return { id: `${mood}-${hoursAgo}`, mood, intensity, ts: AT - hoursAgo * 3_600_000, date }
}

test('概率是 0–1 的小数，并且落在上下限内', () => {
  const day = computeDay(DATE, state(), CFG, { atMs: AT })
  assert.ok(day.probability >= CFG.floor && day.probability <= CFG.ceiling)
  assert.equal(day.noWatchProbability, 1 - day.probability)
  assert.ok(day.probability <= 1 && day.probability >= 0)
})

test('伤感后劲会压低第二天的概率', () => {
  const base = computeDay(DATE, state(), CFG, { atMs: AT }).probability
  const sad = computeDay(DATE, state([entry('sad', 0.9, 3)]), CFG, { atMs: AT }).probability
  assert.ok(sad < base, `sad ${sad} 应该低于 base ${base}`)
  assert.ok(base - sad > 0.08)
})

test('治愈/上头后劲会抬高概率', () => {
  const base = computeDay(DATE, state(), CFG, { atMs: AT }).probability
  const happy = computeDay(DATE, state([entry('hooked', 0.9, 3)]), CFG, { atMs: AT }).probability
  assert.ok(happy > base)
})

test('后劲按半衰期衰减，隔得越久影响越小', () => {
  const fresh = computeDay(DATE, state([entry('sad', 0.9, 2)]), CFG, { atMs: AT }).probability
  const old = computeDay(DATE, state([entry('sad', 0.9, 48)]), CFG, { atMs: AT }).probability
  assert.ok(old > fresh, `48 小时前 ${old} 应高于 2 小时前 ${fresh}`)
})

test('同一天结果稳定，重掷会改变骰子', () => {
  const s = state([entry('sad', 0.6, 5)])
  const a = computeDay(DATE, s, CFG, { atMs: AT })
  const b = computeDay(DATE, s, CFG, { atMs: AT + 3_600_000 })
  assert.equal(a.watch, b.watch)
  assert.equal(a.roll, b.roll)
  const c = computeDay(DATE, s, CFG, { atMs: AT, salt: 3 })
  assert.notEqual(c.roll, a.roll)
})

test('手动强制会覆盖概率结论', () => {
  const s = state([entry('sad', 1, 1)], {}, { override: { [DATE]: 'watch' } })
  const day = computeDay(DATE, s, CFG, { atMs: AT })
  assert.equal(day.watch, true)
  assert.equal(day.forced, true)
  assert.match(verdictText(day, true), /刷/)
})

test('强制时生效概率也定死，宿主不会按原概率再掷一次', () => {
  const skip = computeDay(DATE, state([], {}, { override: { [DATE]: 'skip' } }), CFG, { atMs: AT })
  assert.equal(skip.probability, 0)
  assert.equal(skip.noWatchProbability, 1)
  assert.ok(skip.modelProbability > 0.05, '原始模型概率仍保留，方便面板解释')
  const watch = computeDay(DATE, state([], {}, { override: { [DATE]: 'watch' } }), CFG, { atMs: AT })
  assert.equal(watch.probability, 1)
  assert.equal(watch.noWatchProbability, 0)
})

test('后劲没缓过来的不看日，不算「憋久了」的回弹', () => {
  const normal = state([], {
    [addDays(DATE, -1)]: { watch: false },
    [addDays(DATE, -2)]: { watch: false },
    [addDays(DATE, -3)]: { watch: true },
  })
  const paused = state([], {
    [addDays(DATE, -1)]: { watch: false, moodPause: true },
    [addDays(DATE, -2)]: { watch: false, moodPause: true },
    [addDays(DATE, -3)]: { watch: true },
  })
  const a = computeDay(DATE, normal, CFG, { atMs: AT })
  const b = computeDay(DATE, paused, CFG, { atMs: AT })
  assert.equal(b.gap, 3)
  assert.equal(b.moodPauseDays, 2)
  assert.equal(b.returnGap, 1)
  const ra = a.factors.find((f) => f.key === 'return')
  const rb = b.factors.find((f) => f.key === 'return')
  assert.ok(ra && rb)
  assert.ok(rb.delta < ra.delta)
})

test('连续刷会累积腻烦，断更会回弹', () => {
  const streakState = state([], {
    [addDays(DATE, -1)]: { watch: true, probability: 0.6 },
    [addDays(DATE, -2)]: { watch: true, probability: 0.6 },
    [addDays(DATE, -3)]: { watch: true, probability: 0.6 },
    [addDays(DATE, -4)]: { watch: true, probability: 0.6 },
  })
  const tired = computeDay(DATE, streakState, CFG, { atMs: AT })
  const freshState = state([], { [addDays(DATE, -9)]: { watch: true, probability: 0.6 } })
  const returned = computeDay(DATE, freshState, CFG, { atMs: AT })
  assert.ok(tired.streak >= 4)
  const fatigue = tired.factors.find((f) => f.key === 'fatigue')
  const ret = returned.factors.find((f) => f.key === 'return')
  assert.ok(fatigue && fatigue.delta < 0)
  assert.ok(ret && ret.delta > 0)
})

test('后劲平滑压缩：连续伤感不会无限压低，也不会掉穿下限', () => {
  const four = Array.from({ length: 4 }, (_, i) => entry('sad', 1, 1 + i))
  const ten = Array.from({ length: 10 }, (_, i) => entry('sad', 1, 1 + i))
  const a = computeDay(DATE, state(four), CFG, { atMs: AT })
  const b = computeDay(DATE, state(ten), CFG, { atMs: AT })
  assert.ok(a.probability >= CFG.floor)
  assert.ok(b.probability >= CFG.floor)
  assert.ok(Math.abs(a.probability - b.probability) < 0.02, '平滑压缩后继续叠加不应再明显压低')
})

test('配置越界会被夹到 0–1 的合法范围', () => {
  const cfg = normalizeConfig({ base: 999, halfLifeHours: 0, floor: 0.8, ceiling: 0.2 })
  assert.equal(cfg.base, 0.95)
  assert.equal(cfg.halfLifeHours, 2)
  assert.ok(cfg.ceiling >= cfg.floor + 0.05)
  assert.ok(cfg.floor <= 1 && cfg.ceiling <= 1)
})

test('骰子权重降低后，过半的概率更偏向刷', () => {
  const cfg = normalizeConfig({ ...DEFAULT_CONFIG, base: 0.57, wJitter: 0, diceWeight: 0.3, wReturn: 0.15 })
  const day = computeDay(DATE, state(), cfg, { atMs: AT })
  assert.ok(day.probability > 0.5)
  assert.ok(day.watchChance > day.probability, `判定线 ${day.watchChance} 应高于概率 ${day.probability}`)
})
