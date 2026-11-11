// 把「今天的结论」算出来并落盘。面板和 CLI 都走这一个函数，避免两边算出不同数。

import { MOOD_BY_ID, computeDay, dateOf, summaryText } from './model.js'
import { readDiary } from './diary.js'
import { bootstrap } from './bootstrap.js'
import { exportGate, readConfig, readState } from './store.js'

export function buildSnapshot(now = Date.now()) {
  try {
    bootstrap()
  } catch {}

  const today = dateOf(now)
  const cfg = readConfig()
  const state = readState()
  const diary = readDiary(cfg)
  const past = diary.entries.filter((e) => e.date < today)
  // 只有「真刷了」的日记才算刷过；不刷那天写的解释不能进连刷
  const watchedPast = past.filter((e) => e.watched !== false)
  const decisions = Object.fromEntries(
    past.map((e) => [e.date, e.watched === false ? { watch: false, moodPause: Boolean(e.moodPause) } : { watch: true }]),
  )
  // 不刷那天的情绪不能当「新视频刺激」，但如果明确写着还在后劲里，
  // 就用半权重让它继续衰减，避免「情绪还在 + 断更回弹」同时把概率抬起来。
  const pauseMoods = past
    .filter((e) => e.watched === false && e.moodPause && e.mood && (MOOD_BY_ID[e.mood]?.valence ?? 0) < 0)
    .map((e) => ({ ...e, intensity: Math.max(0, Math.min(1, e.intensity * 0.5)) }))
  const entries = [...watchedPast.filter((e) => e.mood), ...pauseMoods]
  const lastWatched = watchedPast[watchedPast.length - 1]
  const lastMoodEntry = [...watchedPast].reverse().find((e) => e.mood)
  const salt = Number(state.salt?.[today] || 0)
  const day = computeDay(today, { entries, decisions, override: state.override, salt: state.salt }, cfg, { atMs: now, salt })

  const gate = {
    schema: 'whale-mood/gate@1',
    plugin: 'dsh-emotionalwhale',
    date: today,
    updatedAt: new Date(now).toISOString(),
    updatedAtMs: now,
    // probability/noWatchProbability 是「生效值」：强制或重掷后宿主读到的就是它。
    // modelProbability 是模型自己算的原始概率，强制时仍然保留，方便面板解释。
    probability: Math.round(day.probability * 1000) / 1000,
    modelProbability: Math.round((day.modelProbability ?? day.probability) * 1000) / 1000,
    noWatchProbability: Math.round(day.noWatchProbability * 1000) / 1000,
    watchChance: Math.round(day.watchChance * 1000) / 1000,
    watch: day.watch,
    roll: Math.round(day.roll * 1000) / 1000,
    forced: day.forced,
    override: day.override,
    moodScore: Math.round(day.moodScore * 100) / 100,
    topMood: day.topMood?.id || null,
    streak: day.streak,
    gapDays: day.gap,
    returnGap: day.returnGap,
    moodPauseDays: day.moodPauseDays,
    diary: {
      found: diary.found,
      path: diary.path,
      ok: Boolean(diary.target?.ok),
      created: Boolean(diary.target?.created),
      fallback: Boolean(diary.target?.fallback),
      mode: diary.target?.mode || null,
      reason: diary.target?.reason || null,
      latestDate: lastWatched?.date || null,
      latestMood: lastMoodEntry?.mood || null,
      latestMoodDate: lastMoodEntry?.date || null,
      latestDiaryDate: diary.latest?.date || null,
      latestDiaryMood: diary.latest?.mood || null,
      watchedDays: watchedPast.length,
      skippedDays: past.length - watchedPast.length,
    },
    factors: day.factors.map((f) => ({ key: f.key, label: f.label, delta: f.delta })),
    reasons: day.reasons.map((f) => f.label),
    summary: summaryText(day, true),
    config: cfg,
  }

  try {
    exportGate(gate)
  } catch {}
  return { now, today, cfg, state, diary, day, gate, past }
}
