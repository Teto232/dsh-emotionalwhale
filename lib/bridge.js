// 多宿主桥接：让市面上的 B 站「养鱼」插件按情感鲸鱼今天的结论决定刷不刷。
//
// 六类宿主，各打在自己的“总闸门”上，不动具体业务逻辑：
//   1. bili-whale（概率型）：包一层 readNightConfig()，把 skipChance 换成 gate 的 noWatchProbability
//   2. dsh-bili-scroll（配额型）：在自动 tick 开头加一道“今天不刷就返回”
//   3. dsh-fish（生态型）：在 quietBrowse / lookBeforeWake 开头加同一道闸（照常醒来、写日记）
//   4. dsh-whale-panel（看板型）：在自动巡航 setInterval 里加同一道闸（手动操作不受影响）
//   5. dsh-fish-soul（人格型）：在 BiliBrowser.run 开头加同一道闸
//   6. dsh-feed-scroll（多源刷帖型）：自动叫醒刷 B站前加同一道闸（知乎/掘金等非 B站源不受影响）
//
// 每处改动都有 MOOD-BRIDGE-* 标记，第一次改前备份 *.emotionalwhale.bak，可还原、可重复执行。
// 旧版（local-whale-mood）留下的 *.whale-mood.bak 仍能识别和还原。

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listWhalePlugins } from './discover.js'

function gateHelper(style, marker = 'MOOD-BRIDGE') {
  if (style === 'sync-named') {
    // 宿主已经 import { existsSync, readFileSync, join } from 'node:fs' / 'node:path'
    return `
// ${marker} 辅助：读今天的 gate。读不到 / 不是今天 → 当作“照常”，不拦。
function moodSkipToday() {
  try {
    if (process.env.WHALE_MOOD_FORCE === '1') return false
    const home = process.env.DSH_HOME || join(process.env.HOME || '.', '.dsh')
    const file = process.env.WHALE_GATE_DIR
      ? join(process.env.WHALE_GATE_DIR, 'gate.json')
      : join(home, 'whale', 'gate.json')
    if (!existsSync(file)) return false
    const gate = JSON.parse(readFileSync(file, 'utf8'))
    const today = new Date().toLocaleDateString('sv-SE')
    if (gate && gate.date && String(gate.date) !== today) return false
    return gate && gate.watch === false
  } catch {
    return false
  }
}
`
  }
  if (style === 'sync-read') {
    // 宿主已 import { readFileSync }、{ homedir }、{ join }，没有 existsSync
    return `
// ${marker} 辅助
function moodSkipToday() {
  try {
    if (process.env.WHALE_MOOD_FORCE === '1') return false
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    const file = process.env.WHALE_GATE_DIR
      ? join(process.env.WHALE_GATE_DIR, 'gate.json')
      : join(home, 'whale', 'gate.json')
    const gate = JSON.parse(readFileSync(file, 'utf8'))
    const today = new Date().toLocaleDateString('sv-SE')
    if (gate && gate.date && String(gate.date) !== today) return false
    return gate && gate.watch === false
  } catch {
    return false
  }
}
`
  }
  if (style === 'sync-fs') {
    // 宿主 import fs from 'node:fs'，join 已可用
    return `
// ${marker} 辅助
function moodSkipToday() {
  try {
    if (process.env.WHALE_MOOD_FORCE === '1') return false
    const home = process.env.DSH_HOME || join(process.env.HOME || '.', '.dsh')
    const file = process.env.WHALE_GATE_DIR
      ? join(process.env.WHALE_GATE_DIR, 'gate.json')
      : join(home, 'whale', 'gate.json')
    if (!fs.existsSync(file)) return false
    const gate = JSON.parse(fs.readFileSync(file, 'utf8'))
    const today = new Date().toLocaleDateString('sv-SE')
    if (gate && gate.date && String(gate.date) !== today) return false
    return gate && gate.watch === false
  } catch {
    return false
  }
}
`
  }
  if (style === 'async-fs') {
    // 宿主 import fs from 'node:fs/promises'、path 与 os
    return `
// ${marker} 辅助（异步版）
async function moodSkipToday() {
  try {
    if (process.env.WHALE_MOOD_FORCE === '1') return false
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    const file = process.env.WHALE_GATE_DIR
      ? path.join(process.env.WHALE_GATE_DIR, 'gate.json')
      : path.join(home, 'whale', 'gate.json')
    const gate = JSON.parse(await fs.readFile(file, 'utf8'))
    const today = new Date().toLocaleDateString('sv-SE')
    if (gate && gate.date && String(gate.date) !== today) return false
    return gate && gate.watch === false
  } catch {
    return false
  }
}
`
  }
  return ''
}

function read(file) {
  return readFileSync(file, 'utf8')
}

const BAK = '.emotionalwhale.bak'
const OLD_BAK = '.whale-mood.bak'

function backup(file) {
  const bak = `${file}${BAK}`
  if (!existsSync(bak)) writeFileSync(bak, read(file), 'utf8')
  return bak
}

function syntaxOk(file, nodeBin = 'node') {
  try {
    execFileSync(nodeBin, ['--check', file], { stdio: 'ignore' })
    return true
  } catch (error) {
    // App 里可能没有可执行 node；只在“能跑但语法错”时才算失败
    return error?.code === 'ENOENT'
  }
}

function has(file, marker) {
  try {
    return read(file).includes(marker)
  } catch {
    return false
  }
}

function finish(file, src, patched, marker, nodeBin) {
  const bak = backup(file)
  writeFileSync(file, patched, 'utf8')
  if (!syntaxOk(file, nodeBin)) {
    writeFileSync(file, src, 'utf8')
    return { ok: false, file, backup: bak, reason: '改完语法检查不过，已还原' }
  }
  if (!has(file, marker)) {
    writeFileSync(file, src, 'utf8')
    return { ok: false, file, backup: bak, reason: '改动没落上（锚点不匹配），已还原' }
  }
  return { ok: true, file, backup: bak, already: false }
}

/**
 * 把单个文件从 .emotionalwhale.bak（或旧版 .whale-mood.bak）还原。
 * 只有当前文件仍带着我们的补丁时才动；宿主自己升级覆盖过就跳过，避免拿旧备份盖新版本。
 */
function restoreFile(file, isPatched, nodeBin = 'node') {
  const newBak = `${file}${BAK}`
  const oldBak = `${file}${OLD_BAK}`
  const bak = existsSync(newBak) ? newBak : existsSync(oldBak) ? oldBak : ''
  if (!existsSync(file) || !bak) return { file, ok: false, skipped: true, reason: '没有备份' }
  let current
  try {
    current = read(file)
  } catch {
    return { file, ok: false, skipped: true, reason: '读不到当前文件' }
  }
  if (!isPatched(current)) {
    // 补丁已经不在（例如宿主升级覆盖），备份是旧版本的，不能拿来覆盖新文件
    try {
      unlinkSync(bak)
      if (bak === newBak && existsSync(oldBak)) unlinkSync(oldBak)
    } catch {}
    return { file, ok: false, skipped: true, reason: '补丁已不在，保留宿主当前文件' }
  }
  const original = read(bak)
  try {
    writeFileSync(file, original, 'utf8')
    if (!syntaxOk(file, nodeBin)) throw new Error('还原后语法检查不过')
    unlinkSync(bak)
    if (bak === newBak && existsSync(oldBak)) unlinkSync(oldBak)
    return { file, ok: true, skipped: false }
  } catch (error) {
    try {
      writeFileSync(file, current, 'utf8')
    } catch {}
    return { file, ok: false, skipped: false, reason: String(error?.message || error) }
  }
}

/** 卸掉一个宿主上的桥接（主文件 + bili-whale 设置页文案）。 */
export function restoreBridge(pluginDir, opt = {}) {
  if (!pluginDir) return { ok: false, reason: '没找到插件目录' }
  const host = detectHost(pluginDir)
  if (!host) return { ok: false, skipped: true, reason: '不认识这个插件' }
  const st = host.status(pluginDir)
  const changes = []
  if (st.file) {
    const r = restoreFile(st.file, (text) => text.includes(host.marker), opt?.nodeBin)
    if (r.ok) changes.push(r)
  }
  if (host.id === 'bili-whale') {
    for (const rel of ['lib/client.js', 'lib/client.mjs']) {
      const f = join(pluginDir, rel)
      if (!existsSync(f)) continue
      const r = restoreFile(f, (text) => text.includes('情感鲸鱼接管') || text.includes('鲸鱼心情接管'), opt?.nodeBin)
      if (r.ok) changes.push(r)
    }
  }
  return { ...host.status(pluginDir), hostId: host.id, hostLabel: host.label, ok: changes.length > 0, changed: changes.length, changes }
}

/** 卸载本插件时调用：把所有打过补丁的养鱼宿主还原回原文。 */
export function restoreAllBridges(dirs = null, opt = {}) {
  const list = dirs || listWhalePlugins().map((p) => ({ name: p.name, dir: p.dir }))
  const results = []
  for (const p of list) {
    try {
      const r = restoreBridge(p.dir, opt)
      if (r.changed) results.push({ name: p.name, dir: p.dir, ...r })
    } catch {}
  }
  return results
}

function pkgText(dir) {
  try {
    return read(join(dir, 'package.json'))
  } catch {
    return ''
  }
}

// ── 1. bili-whale ───────────────────────────────────────────────────────────
const BILI_WHALE = {
  id: 'bili-whale',
  label: 'bili-whale（概率型）',
  marker: 'MOOD-BRIDGE',
  file(dir) {
    for (const rel of ['tools/lib/night-config.mjs', 'tools/lib/night-config.js', 'lib/night-config.mjs']) {
      const f = join(dir, rel)
      if (existsSync(f)) return f
    }
    return null
  },
  detect(dir) {
    const file = this.file(dir)
    if (!file) return false
    return /bili[-_]?whale/i.test(pkgText(dir)) || read(file).includes('readNightConfig')
  },
  status(dir) {
    const file = this.file(dir)
    return { supported: Boolean(file), file, bridged: Boolean(file && has(file, this.marker)) }
  },
  apply(dir, opt) {
    const file = this.file(dir)
    if (!file) return { ok: false, reason: '没有 night-config.mjs，可能不是 bili-whale' }
    const src = read(file)
    if (has(file, this.marker)) return { ok: true, already: true, file }
    if (!/export\s+function\s+readNightConfig\b/.test(src)) {
      return { ok: false, file, reason: '结构对不上：找不到 export function readNightConfig' }
    }

    let patched = src.replace(/export\s+function\s+readNightConfig\b/, 'function readNightConfigBase')
    patched += `
// MOOD-BRIDGE：由「情感鲸鱼」写入。读今天的 gate.json 接管 skipChance；
// 读不到 / 不是今天的结论时，完全退回原来的配置值。
function moodGateChance(home = DSH_HOME) {
  try {
    const file = process.env.WHALE_GATE_DIR
      ? path.join(process.env.WHALE_GATE_DIR, 'gate.json')
      : path.join(home, 'whale', 'gate.json')
    if (!fs.existsSync(file)) return null
    const gate = JSON.parse(fs.readFileSync(file, 'utf8'))
    const p = Number(gate && gate.noWatchProbability)
    if (!Number.isFinite(p) || p < 0 || p > 1) return null
    const today = new Date().toLocaleDateString('sv-SE')
    if (gate && gate.date && String(gate.date) !== today) return null
    return p
  } catch {
    return null
  }
}
export function readNightConfig(home = DSH_HOME) {
  const base = readNightConfigBase(home)
  const p = moodGateChance(home)
  return p == null ? base : { ...base, skipChance: p }
}
`
    const r = finish(file, src, patched, this.marker, opt?.nodeBin)
    if (!r.ok) return r

    // 设置页文案（失败不影响功能）
    for (const rel of ['lib/client.js', 'lib/client.mjs']) {
      const f = join(dir, rel)
      if (!existsSync(f)) continue
      try {
        const text = read(f)
        if (!text.includes('今晚不看的概率')) continue
        backup(f)
        writeFileSync(
          f,
          text
            .replace('label: "今晚不看的概率"', 'label: "今晚不看的概率（情感鲸鱼接管）"')
            .replace('hint: "0.3 = 三成"', 'hint: "读 gate 的 noWatchProbability（= 1 − 想刷概率）；这里的数只在读不到时兜底"'),
          'utf8',
        )
        r.ui = f
      } catch {}
    }
    return r
  },
}

// ── 2. dsh-bili-scroll ──────────────────────────────────────────────────────
const BILI_SCROLL = {
  id: 'bili-scroll',
  label: 'dsh-bili-scroll（配额型）',
  marker: 'MOOD-BRIDGE-SCROLL',
  file(dir) {
    const f = join(dir, 'index.js')
    return existsSync(f) ? f : null
  },
  detect(dir) {
    const f = this.file(dir)
    if (!f) return false
    try {
      const text = read(f)
      return /bili[-_]?scroll/i.test(pkgText(dir)) || (text.includes('__slotDice') && text.includes('refreshCfg()'))
    } catch {
      return false
    }
  },
  status(dir) {
    const file = this.file(dir)
    return { supported: Boolean(file && this.detect(dir)), file, bridged: Boolean(file && has(file, this.marker)) }
  },
  apply(dir, opt) {
    const file = this.file(dir)
    if (!file || !this.detect(dir)) return { ok: false, reason: '不是 dsh-bili-scroll 的结构' }
    const src = read(file)
    if (has(file, this.marker)) return { ok: true, already: true, file }

    const anchor = /refreshCfg\(\)([^\n]*)\n(\s*)if \(!cfg\.peakValley\) return/
    if (!anchor.test(src)) return { ok: false, file, reason: '找不到自动 tick 的闸门（版本可能变了）' }

    let patched = src.replace(anchor, (m, tail, indent) => `refreshCfg()${tail}\n${indent}if (moodSkipToday()) return\n${indent}if (!cfg.peakValley) return`)
    patched += gateHelper('sync-named', this.marker)
    return finish(file, src, patched, this.marker, opt?.nodeBin)
  },
}

// ── 3. dsh-fish ─────────────────────────────────────────────────────────────
const FISH = {
  id: 'dsh-fish',
  label: 'dsh-fish（生态型）',
  marker: 'MOOD-BRIDGE-FISH',
  file(dir) {
    const f = join(dir, 'lib/scheduler.js')
    return existsSync(f) ? f : null
  },
  detect(dir) {
    const f = this.file(dir)
    if (!f) return false
    try {
      return read(f).includes('quietBrowse')
    } catch {
      return false
    }
  },
  status(dir) {
    const file = this.file(dir)
    return { supported: Boolean(file && this.detect(dir)), file, bridged: Boolean(file && has(file, this.marker)) }
  },
  apply(dir, opt) {
    const file = this.file(dir)
    if (!file || !this.detect(dir)) return { ok: false, reason: '不是 dsh-fish 的结构' }
    const src = read(file)
    if (has(file, this.marker)) return { ok: true, already: true, file }

    const quiet = "  if (!biliOn(config)) return no('现在上不了网')"
    const look = '  if (!config?.browse?.enabled) return empty'
    if (!src.includes(quiet) || !src.includes(look)) {
      return { ok: false, file, reason: '找不到 quietBrowse / lookBeforeWake 的闸门（版本可能变了）' }
    }

    let patched = src
      .replace("import { join } from 'node:path'", "import fs from 'node:fs'\nimport { join } from 'node:path'")
      .replace(quiet, `${quiet}\n  if (deps.force !== true && moodSkipToday()) return no('今天不想刷视频')`)
      .replace(look, `${look}\n  if (deps.forceBrowse !== true && moodSkipToday()) return empty`)
      .replace(/\n+$/, '\n')
    if (!/from ['"]node:fs['"]/.test(patched)) patched = "import fs from 'node:fs'\n" + patched
    if (!/from ['"]node:path['"]/.test(patched)) patched = "import { join } from 'node:path'\n" + patched
    patched += gateHelper('sync-fs', this.marker)
    return finish(file, src, patched, this.marker, opt?.nodeBin)
  },
}

// ── 4. dsh-whale-panel ──────────────────────────────────────────────────────
const WHALE_PANEL = {
  id: 'whale-panel',
  label: 'dsh-whale-panel（看板型）',
  marker: 'MOOD-BRIDGE-PANEL',
  file(dir) {
    const f = join(dir, 'index.js')
    return existsSync(f) ? f : null
  },
  detect(dir) {
    const f = this.file(dir)
    if (!f) return false
    try {
      const text = read(f)
      return text.includes('whale-panel/api') && text.includes('nextRunAt')
    } catch {
      return false
    }
  },
  status(dir) {
    const file = this.file(dir)
    return { supported: Boolean(file && this.detect(dir)), file, bridged: Boolean(file && has(file, this.marker)) }
  },
  apply(dir, opt) {
    const file = this.file(dir)
    if (!file || !this.detect(dir)) return { ok: false, reason: '不是 dsh-whale-panel 的结构' }
    const src = read(file)
    if (has(file, this.marker)) return { ok: true, already: true, file }

    const anchor = 'if (!state.autoRun || state.paused) return'
    if (!src.includes(anchor)) return { ok: false, file, reason: '找不到自动巡航闸门（版本可能变了）' }

    let patched = src.replace(anchor, 'if (!state.autoRun || state.paused || (await moodSkipToday())) return')
    patched += gateHelper('async-fs', this.marker)
    return finish(file, src, patched, this.marker, opt?.nodeBin)
  },
}

// ── 5. dsh-fish-soul ────────────────────────────────────────────────────────
const FISH_SOUL = {
  id: 'fish-soul',
  label: 'dsh-fish-soul（人格型）',
  marker: 'MOOD-BRIDGE-FISH-SOUL',
  file(dir) {
    const f = join(dir, 'lib/browse.js')
    return existsSync(f) ? f : null
  },
  detect(dir) {
    const f = this.file(dir)
    if (!f) return false
    try {
      const text = read(f)
      return /fish[-_]?soul/i.test(pkgText(dir)) || (text.includes('BiliBrowser') && text.includes('async run('))
    } catch {
      return false
    }
  },
  status(dir) {
    const file = this.file(dir)
    return { supported: Boolean(file && this.detect(dir)), file, bridged: Boolean(file && has(file, this.marker)) }
  },
  apply(dir, opt) {
    const file = this.file(dir)
    if (!file || !this.detect(dir)) return { ok: false, reason: '不是 dsh-fish-soul 的结构' }
    const src = read(file)
    if (has(file, this.marker)) return { ok: true, already: true, file }

    const anchor = "\tasync run({ count } = {}) {\n\t\tif (this.running) return { ok: false, error: '正在刷，稍等' };"
    if (!src.includes(anchor)) return { ok: false, file, reason: '找不到 BiliBrowser.run（版本可能变了）' }

    let patched = src
      .replace("import { getKv, setKv } from './db.js';", "import fs from 'node:fs';\nimport { join } from 'node:path';\nimport { getKv, setKv } from './db.js';")
      .replace(anchor, `${anchor}\n\t\tif (moodSkipToday()) return { ok: false, error: '今天不想刷视频' };`)
      .replace(/\n+$/, '\n')
    // 兜底：源码里没有这两条 import 时补在最前面，否则 helper 里 fs/join 会 undefined
    let pre = ''
    if (!/from ['"]node:fs['"]/.test(patched)) pre += "import fs from 'node:fs';\n"
    if (!/from ['"]node:path['"]/.test(patched)) pre += "import { join } from 'node:path';\n"
    patched = pre + patched
    patched += gateHelper('sync-fs', this.marker)
    return finish(file, src, patched, this.marker, opt?.nodeBin)
  },
}

// ── 6. dsh-feed-scroll ──────────────────────────────────────────────────────
const FEED_SCROLL = {
  id: 'feed-scroll',
  label: 'dsh-feed-scroll（多源刷帖型）',
  marker: 'MOOD-BRIDGE-FEED',
  file(dir) {
    const f = join(dir, 'index.js')
    return existsSync(f) ? f : null
  },
  detect(dir) {
    const f = this.file(dir)
    if (!f) return false
    try {
      const text = read(f)
      return /dsh[-_]?feed[-_]?scroll/i.test(pkgText(dir)) || (text.includes('runWatchTick') && text.includes('feed_scroll'))
    } catch {
      return false
    }
  },
  status(dir) {
    const file = this.file(dir)
    return { supported: Boolean(file && this.detect(dir)), file, bridged: Boolean(file && has(file, this.marker)) }
  },
  apply(dir, opt) {
    const file = this.file(dir)
    if (!file || !this.detect(dir)) return { ok: false, reason: '不是 dsh-feed-scroll 的结构' }
    const src = read(file)
    if (has(file, this.marker)) return { ok: true, already: true, file }

    const anchor =
      /(for \(const target of Object\.values\(state\.targets\)\) \{\n(\s*)const watch = target\.watch\n\2if \(!watch \|\| watch\.enabled === false\) continue)/
    if (!anchor.test(src)) return { ok: false, file, reason: '找不到定时刷帖的循环（版本可能变了）' }

    let patched = src.replace(anchor, (_m, head, indent) => {
      const gate = `${indent}// 只在刷 B站（或 auto 混刷）时受心情闸门影响，知乎/掘金等源照常
${indent}if ((!watch.source || watch.source === 'auto' || String(watch.source).startsWith('bilibili')) && moodSkipToday()) continue`
      return `${head}\n${gate}`
    })
    patched += gateHelper('sync-read', this.marker)
    return finish(file, src, patched, this.marker, opt?.nodeBin)
  },
}

const HOSTS = [BILI_WHALE, BILI_SCROLL, FISH, FISH_SOUL, WHALE_PANEL, FEED_SCROLL]

export function detectHost(pluginDir) {
  for (const host of HOSTS) {
    try {
      if (host.detect(pluginDir)) return host
    } catch {}
  }
  return null
}

/** 给一个插件目录打桥接（自动判断是哪一类）。 */
export function applyBridge(pluginDir, opt = {}) {
  if (!pluginDir) return { ok: false, reason: '没找到插件目录' }
  const host = detectHost(pluginDir)
  if (!host) return { ok: false, reason: '不认识这个插件（没有可接的总闸门）' }
  const r = host.apply(pluginDir, opt)
  return { ...r, hostId: host.id, hostLabel: host.label }
}

/** 给所有认识的宿主打一遍（认不出的插件直接略过，不动文件）。 */
export function applyAllBridges(dirs = null, opt = {}) {
  const list = dirs || listWhalePlugins().map((p) => ({ name: p.name, dir: p.dir }))
  const results = []
  for (const p of list) {
    const host = detectHost(p.dir)
    if (!host) continue
    results.push({ name: p.name, dir: p.dir, ...applyBridge(p.dir, opt) })
  }
  return results
}

/** 当前装了哪些养鱼宿主、各自接上没有。 */
export function bridgeStatus() {
  const list = listWhalePlugins()
  const hosts = []
  for (const p of list) {
    const host = detectHost(p.dir)
    if (!host) continue
    const st = host.status(p.dir)
    if (!st.supported) continue
    hosts.push({
      name: p.name,
      dir: p.dir,
      hostId: host.id,
      label: host.label,
      supported: true,
      file: st.file,
      bridged: Boolean(st.bridged),
      backup: Boolean(st.file && (existsSync(`${st.file}${BAK}`) || existsSync(`${st.file}${OLD_BAK}`))),
      backupKind: st.file && existsSync(`${st.file}${BAK}`) ? 'new' : st.file && existsSync(`${st.file}${OLD_BAK}`) ? 'old' : null,
    })
  }
  const bridgedHosts = hosts.filter((h) => h.bridged)
  return {
    installed: hosts.length > 0,
    bridged: hosts.length > 0 && bridgedHosts.length === hosts.length,
    hosts,
    supported: hosts.length,
    bridgedCount: bridgedHosts.length,
    totalPlugins: list.length,
    unsupported: list.length - hosts.length,
    pluginDir: hosts[0]?.dir || null,
    file: hosts[0]?.file || null,
  }
}

/** 兼容旧调用：bili-whale 的配置文件位置。 */
export function bridgeFile(pluginDir) {
  return BILI_WHALE.file(pluginDir)
}

export function isBridged(file) {
  return has(file, 'MOOD-BRIDGE')
}
