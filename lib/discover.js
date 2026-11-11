// 自己找 bili-whale / dsh-emotionalwhale 在哪，以及它的日记落在哪。
//
// 不要求用户先建对话或手动填路径：插件第一次加载时会扫一遍插件目录和常见日记位置，
// 找到就把 diaryPath 写进自己的配置，找不到就退回默认目录（由 diaryPath.js 创建）。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fishHome } from './fishHome.js'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

const ROOTS = [join(DSH_HOME, 'dsh-go', 'plugins'), join(DSH_HOME, 'plugins')]

const HOME_DIARIES = [
  join(DSH_HOME, 'whale', 'diary'),
  join(DSH_HOME, 'whale', 'diaries'),
  join(DSH_HOME, 'whale-diary.md'),
  join(DSH_HOME, 'dsh-go', 'diary'),
  join(DSH_HOME, 'diary'),
  // 其它养鱼宿主的每日产物：bili-scroll 的日报、dsh-fish 的每日报告
  join(DSH_HOME, 'bili-duty', 'out'),
  join(DSH_HOME, 'fish', 'out'),
  join(DSH_HOME, 'fish-soul', 'out'),
  join(DSH_HOME, 'fish-soul', 'soul.db'),
  join(fishHome(), 'diary'),
  join(fishHome(), 'out'),
]

const WHALE_NAMES = [/^bili[-_]?whale$/i, /^dsh[-_]?whale$/i, /bili[-_]?whale/i, /dsh[-_]?whale/i, /whale/i, /鲸鱼/i]

function expand(p) {
  if (typeof p !== 'string') return null
  const t = p.trim()
  if (!t) return null
  return t.startsWith('~') ? join(homedir(), t.slice(1)) : t
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function listDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(dir, d.name))
  } catch {
    return []
  }
}

function pluginMeta(dir) {
  const pkg = readJson(join(dir, 'package.json'))
  return {
    dir,
    name: pkg?.name || dir.split('/').pop(),
    description: pkg?.description || '',
    title: pkg?.dshGo?.title?.zh || pkg?.dshGo?.title?.en || '',
  }
}

function scorePlugin(meta) {
  let score = 0
  for (const re of WHALE_NAMES) {
    if (re.test(meta.name) || re.test(meta.title)) score = Math.max(score, 60)
    if (re.test(meta.description)) score = Math.max(score, 30)
  }
  if (/^bili[-_]?whale$/i.test(meta.name)) score = 100
  if (/^dsh[-_]?whale$/i.test(meta.name)) score = 95
  return score
}

function hasDiaryFiles(target) {
  try {
    const st = statSync(target)
    const exts = ['.md', '.markdown', '.txt', '.json', '.jsonl', '.db']
    if (st.isFile()) return exts.includes(target.slice(target.lastIndexOf('.')).toLowerCase())
    return readdirSync(target).some((f) => exts.includes(f.slice(f.lastIndexOf('.')).toLowerCase()))
  } catch {
    return false
  }
}

function looksLikeDiaryPath(value) {
  const p = expand(value)
  if (!p) return null
  // 配置里明确写着 diaryPath 的，路径叫什么都可以；不存在就留给后面创建
  if (!p.startsWith('/') && !p.startsWith('.')) return null
  try {
    if (existsSync(p) && statSync(p).isFile()) return p
  } catch {}
  return p
}

// 在插件的几个常见配置里找 diary / 日记 字样
function diaryFromConfigs(dir) {
  const files = [
    join(dir, 'state', 'config.json'),
    join(dir, 'state', 'settings.json'),
    join(dir, 'config.json'),
    join(dir, 'settings.json'),
    join(dir, 'data', 'config.json'),
  ]
  for (const file of files) {
    if (!existsSync(file)) continue
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const re = /"([^"]*(?:diary|日记)[^"]*)"\s*:\s*"([^"]+)"/gi
    let m
    while ((m = re.exec(text))) {
      const p = looksLikeDiaryPath(m[2])
      if (p && existsSync(p) && hasDiaryFiles(p)) return { path: p, source: `${file}#${m[1]}` }
    }
  }
  return null
}

function diaryInPlugin(dir) {
  for (const sub of ['diary', 'diaries', '日记', 'logs', 'state/diary']) {
    const p = join(dir, sub)
    if (existsSync(p) && hasDiaryFiles(p)) return { path: p, source: `dir:${sub}` }
  }
  return null
}

/** 所有插件目录（先按“像养鱼”排序，桥接时再逐个看结构）。 */
export function listWhalePlugins() {
  const out = []
  for (const root of ROOTS) {
    for (const dir of listDirs(root)) {
      const meta = pluginMeta(dir)
      if (meta.name === 'dsh-emotionalwhale' || meta.name === 'dsh-whale' || meta.name === 'local-whale-mood') continue
      let score = scorePlugin(meta)
      if (/bili[-_]?scroll|bili[-_]?fish|dsh[-_]?fish|bili[-_]?whale|dsh[-_]?whale|whale[-_]?panel|fish[-_]?soul/i.test(meta.name)) score += 50
      const desc = `${meta.description} ${meta.title}`
      if (/bilibili|B站|bili/i.test(desc) && /刷|browse|scroll|养|fish|whale|自动/i.test(desc)) score += 20
      // 只把“像 B 站养鱼”的插件放进候选，避免每次巡检去读几百个无关插件的 index.js
      if (score > 0 || /bilibili|B站|bili[-_]|bili|fish|whale|scroll|养鱼|养成/i.test(`${meta.name} ${desc}`)) out.push({ ...meta, score })
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

/**
 * @returns {{found:boolean, pluginName:string|null, pluginDir:string|null, diaryPath:string|null, source:string|null, evidence:string[]}}
 */
export function discoverWhale({ fresh = false } = {}) {
  if (!fresh && discoverWhale.cache) return discoverWhale.cache

  const evidence = []
  const plugins = []
  for (const root of ROOTS) {
    for (const dir of listDirs(root)) {
      const meta = pluginMeta(dir)
      if (meta.name === 'dsh-emotionalwhale' || meta.name === 'dsh-whale' || meta.name === 'local-whale-mood') continue
      const score = scorePlugin(meta)
      if (score > 0) plugins.push({ ...meta, score })
    }
  }
  plugins.sort((a, b) => b.score - a.score)
  if (plugins.length) evidence.push(`候选插件：${plugins.map((p) => p.name).join('、')}`)

  // 先看排名最高的插件里有没有日记
  for (const plugin of plugins) {
    const inPlugin = diaryInPlugin(plugin.dir)
    const inConfig = diaryFromConfigs(plugin.dir)
    if (inConfig) evidence.push(`配置里找到日记：${inConfig.source}`)
    if (inPlugin) evidence.push(`插件目录里找到：${inPlugin.source}`)
    if (inConfig || inPlugin) {
      const hit = { ...plugin, diaryPath: (inConfig || inPlugin).path, source: (inConfig || inPlugin).source }
      const result = { found: true, pluginName: hit.name, pluginDir: hit.dir, diaryPath: hit.diaryPath, source: hit.source, evidence }
      discoverWhale.cache = result
      return result
    }
  }

  // 再看家目录里的常见日记位置
  for (const dir of HOME_DIARIES) {
    if (existsSync(dir) && hasDiaryFiles(dir)) {
      evidence.push(`家目录日记：${dir}`)
      const result = { found: true, pluginName: plugins[0]?.name || null, pluginDir: plugins[0]?.dir || null, diaryPath: dir, source: `home:${dir}`, evidence }
      discoverWhale.cache = result
      return result
    }
  }

  const result = { found: false, pluginName: plugins[0]?.name || null, pluginDir: plugins[0]?.dir || null, diaryPath: null, source: null, evidence }
  discoverWhale.cache = result
  return result
}

/** 宿主插件（bili-whale）的安装目录，给安装脚本和自检用。 */
export function whalePluginDir() {
  return discoverWhale().pluginDir
}
