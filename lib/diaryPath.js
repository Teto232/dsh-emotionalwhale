// 日记路径自检：
//   - 显式给了路径就用它；没给就找已有的候选目录；都没有就创建默认目录。
//   - 目录要存在、可读、可写；文件要存在、可读、可写。
//   - 不满足就按类型创建；创建失败再退到插件自己的 state/diary。
//
// 插件只保证“这个位置能用”，不往里写日记内容——日记由 dsh / bili-whale 写。

import { accessSync, constants, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fishHome } from './fishHome.js'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const EXTS = new Set(['.md', '.markdown', '.txt', '.json', '.jsonl', '.db'])

export const DEFAULT_DIARY = join(DSH_HOME, 'whale', 'diary')

export const CANDIDATES = [
  DEFAULT_DIARY,
  join(DSH_HOME, 'whale', 'diaries'),
  join(DSH_HOME, 'whale-diary.md'),
  join(DSH_HOME, 'dsh-go', 'diary'),
  join(DSH_HOME, 'diary'),
  join(DSH_HOME, 'dsh-go', 'plugins', 'bili-whale', 'diary'),
  join(DSH_HOME, 'dsh-go', 'plugins', 'dsh-emotionalwhale', 'diary'),
  // 其它养鱼宿主：bili-scroll 日报、dsh-fish 日记、dsh-fish-soul 的 SQLite 日记
  join(DSH_HOME, 'bili-duty', 'out'),
  join(fishHome(), 'diary'),
  join(fishHome(), 'out'),
  join(DSH_HOME, 'fish-soul', 'out'),
  join(DSH_HOME, 'fish-soul', 'soul.db'),
]

function expand(p) {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p
}

function isFileTarget(path) {
  return EXTS.has(extname(path).toLowerCase())
}

function can(path, mode) {
  try {
    accessSync(path, mode)
    return true
  } catch {
    return false
  }
}

function check(path) {
  if (!existsSync(path)) return { ok: false, reason: 'missing' }
  try {
    const st = statSync(path)
    const wantFile = isFileTarget(path)
    if (wantFile && !st.isFile()) return { ok: false, reason: 'not-file' }
    if (!wantFile && !st.isDirectory()) return { ok: false, reason: 'not-dir' }
    if (!can(path, constants.R_OK)) return { ok: false, reason: 'unreadable' }
    if (!can(path, constants.W_OK)) return { ok: false, reason: 'unwritable' }
    return { ok: true, mode: wantFile ? 'file' : 'dir' }
  } catch (error) {
    return { ok: false, reason: 'stat-failed', error: String(error?.message || error) }
  }
}

function create(path) {
  const wantFile = isFileTarget(path)
  try {
    // 不凭空造一个 .db：空文件不是合法 SQLite，会让人以为日记读到了
    if (wantFile && extname(path).toLowerCase() === '.db') return false
    if (wantFile) {
      mkdirSync(dirname(path), { recursive: true })
      if (!existsSync(path)) writeFileSync(path, '', 'utf8')
    } else {
      mkdirSync(path, { recursive: true })
    }
    return true
  } catch {
    return false
  }
}

function inspectOrCreate(path) {
  const before = check(path)
  if (before.ok) return { path, ...before, created: false, fallback: false }
  if (before.reason === 'missing') {
    const made = create(path)
    const after = made ? check(path) : { ok: false, reason: 'create-failed' }
    return { path, ...after, created: made && after.ok, fallback: false }
  }
  // 类型不对 / 不可读不可写：不硬改用户的目录，退到默认位置
  return { path, ...before, created: false, fallback: false, error: before.reason }
}

function hasAnyFile(dir) {
  try {
    const st = statSync(dir)
    if (st.isFile()) return EXTS.has(extname(dir).toLowerCase())
    return readdirSync(dir).some((f) => EXTS.has(extname(f).toLowerCase()))
  } catch {
    return false
  }
}

/**
 * 决定这次用哪个日记位置，并保证它可用。
 * @returns {{ path:string, mode:'dir'|'file', ok:boolean, created:boolean, fallback:boolean, reason?:string }}
 */
export function resolveDiaryTarget(cfg, fallbackDir = DEFAULT_DIARY) {
  const explicit = typeof cfg?.diaryPath === 'string' && cfg.diaryPath.trim() !== '' ? expand(cfg.diaryPath.trim()) : null

  if (explicit) {
    const first = inspectOrCreate(explicit)
    if (first.ok) return first
    // 显式路径用不了：退回默认位置，并标明 fallback
    const backup = inspectOrCreate(fallbackDir)
    return { ...backup, fallback: true, reason: first.reason || 'explicit-failed' }
  }

  // 没显式指定：先用已有内容的候选，避免无脑新建
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate) && hasAnyFile(candidate)) {
      const found = check(candidate)
      if (found.ok) return { path: candidate, ...found, created: false, fallback: false }
    }
  }
  return inspectOrCreate(fallbackDir)
}
