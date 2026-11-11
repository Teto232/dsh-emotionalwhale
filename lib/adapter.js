// 给宿主插件（bili-whale / dsh-emotionalwhale 之类）用的小适配层。
//
// 宿主不需要改逻辑，只要把原来写死的「每日不刷视频概率」换成一次读取：
//
//   import { noWatchProbability } from '.../dsh-emotionalwhale/lib/adapter.js'
//   const p = noWatchProbability(1)     // 读不到 gate 时退回原来的 1；返回值 0–1
//
// 或者用命令行（宿主不是 Node ESM 也能用）：
//
//   node ~/.dsh/dsh-go/plugins/dsh-emotionalwhale/bin/dsh-emotionalwhale.mjs --no-watch
//
// 读的是 ~/.dsh/whale/gate.json（可用 WHALE_GATE_DIR 改）。

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const GATE_DIR = process.env.WHALE_GATE_DIR || join(DSH_HOME, 'whale')

export function gatePath() {
  return join(GATE_DIR, 'gate.json')
}

function readJson(file) {
  try {
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 读今天的 gate。过期（不是今天的）就返回 null，宿主会退回自己的默认值。
 * @param {{ allowStale?: boolean, maxAgeHours?: number }} [opts]
 */
export function readGate(opts = {}) {
  const gate = readJson(gatePath())
  if (!gate || typeof gate.probability !== 'number') return null
  const now = Date.now()
  const ageH = (now - Number(gate.updatedAtMs || 0)) / 3_600_000
  const maxAge = Number.isFinite(opts.maxAgeHours) ? opts.maxAgeHours : 36
  if (!opts.allowStale && Number.isFinite(ageH) && ageH > maxAge) return null
  return gate
}

/** 今日「不刷」概率，0–1（1 = 100%）。读不到就用 fallback（宿主原来的写死值）。 */
export function noWatchProbability(fallback = 1) {
  const gate = readGate()
  if (!gate) return fallback
  return Math.min(1, Math.max(0, gate.noWatchProbability))
}

/** 今日「想刷」概率，0–1（1 = 100%）。 */
export function watchProbability(fallback = 0.7) {
  const gate = readGate()
  if (!gate) return fallback
  return Math.min(1, Math.max(0, gate.probability))
}

/** 今天到底刷不刷（本插件已经掷好了，宿主不用再掷一次）。 */
export function shouldWatchToday(fallback = true) {
  const gate = readGate()
  if (!gate) return fallback
  return gate.watch === true
}
