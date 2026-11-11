// 状态与文件落地：插件自己的 state/ 目录 + 给别的插件读的公共 gate 文件。
//
// 日记已经是历史记录，这里只留三样最小的状态：权重、今天的强制、今天的重掷次数。
//
// 路径优先级：
//   WHALE_MOOD_DIR  → 插件自己的数据目录
//   WHALE_GATE_DIR  → 公共 gate 文件目录（宿主插件读这里）
//   默认 ~/.dsh/dsh-go/plugins/dsh-emotionalwhale/state 与 ~/.dsh/whale

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { normalizeConfig } from './model.js'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

/**
 * 把上一代 state 里的 JSON 复制到新目录（只补缺失文件，不覆盖新文件）。
 * 改名后的用户第一次运行时调用；复制成功后所有读写都落新目录，
 * 这样用户删旧插件文件夹时，权重/强制/自检不会跟着消失。
 */
function migrateState(target, sources) {
  try {
    mkdirSync(target, { recursive: true })
  } catch {
    return false
  }
  for (const srcDir of sources) {
    if (!existsSync(srcDir)) continue
    let names = []
    try {
      names = readdirSync(srcDir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const src = join(srcDir, name)
      const dst = join(target, name)
      if (existsSync(dst)) continue
      try {
        copyFileSync(src, dst)
      } catch {}
    }
  }
  return true
}

export function paths() {
  const newState = join(DSH_HOME, 'dsh-go', 'plugins', 'dsh-emotionalwhale', 'state')
  const prevState = join(DSH_HOME, 'dsh-go', 'plugins', 'dsh-whale', 'state')
  const oldState = join(DSH_HOME, 'dsh-go', 'plugins', 'local-whale-mood', 'state')
  // 改名前装过的用户：先把旧 state 复制到新目录，再只写新目录。
  let stateDir = process.env.WHALE_MOOD_DIR || newState
  if (!process.env.WHALE_MOOD_DIR) {
    try {
      migrateState(newState, [prevState, oldState])
    } catch {}
    if (!existsSync(newState)) stateDir = existsSync(prevState) ? prevState : existsSync(oldState) ? oldState : newState
  }
  const gateDir = process.env.WHALE_GATE_DIR || join(DSH_HOME, 'whale')
  return {
    stateDir,
    gateDir,
    config: join(stateDir, 'config.json'),
    state: join(stateDir, 'state.json'),
    gate: join(gateDir, 'gate.json'),
    gateLocal: join(stateDir, 'gate.json'),
  }
}

function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

// 先写临时文件再改名：中途断电不会留下半个 JSON。
export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const text = JSON.stringify(value, null, 2)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, file)
}

export function readConfig() {
  return normalizeConfig(readJson(paths().config, null))
}

export function writeConfig(cfg) {
  writeJson(paths().config, normalizeConfig(cfg))
}

// state 只剩：今天强制刷/不刷、今天重掷了几次。
export function readState() {
  const raw = readJson(paths().state, null)
  const state = raw && typeof raw === 'object' ? raw : {}
  if (!state.override || typeof state.override !== 'object') state.override = {}
  if (!state.salt || typeof state.salt !== 'object') state.salt = {}
  return state
}

export function writeState(state) {
  writeJson(paths().state, state)
}

export function setOverride(date, mode) {
  const state = readState()
  if (mode === 'watch' || mode === 'skip') state.override[date] = mode
  else delete state.override[date]
  writeState(state)
  return readState()
}

export function bumpSalt(date) {
  const state = readState()
  state.salt[date] = Number(state.salt[date] || 0) + 1
  // 只留今天，免得文件越来越长
  for (const key of Object.keys(state.salt)) if (key < date) delete state.salt[key]
  writeState(state)
  return readState()
}

export function exportGate(gate) {
  const p = paths()
  writeJson(p.gate, gate)
  writeJson(p.gateLocal, gate)
}

export function readGate() {
  return readJson(paths().gate, null) || readJson(paths().gateLocal, null)
}
