// 内置自检：安装后、面板里、命令行都能跑同一套检查。
// 只检查、不改宿主；需要时会把日记目录建好、gate 写一份。

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DEFAULT_CONFIG, computeDay, dateOf } from './model.js'
import { bootstrap } from './bootstrap.js'
import { buildSnapshot } from './snapshot.js'
import { noWatchProbability } from './adapter.js'
import { bridgeStatus } from './bridge.js'
import { paths, writeJson } from './store.js'
import { readDiary } from './diary.js'
import { hostActivityDates } from './hostActivity.js'
import { fishHome } from './fishHome.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const REQUIRED = [
  'index.js',
  'model.js',
  'store.js',
  'diary.js',
  'diaryPath.js',
  'discover.js',
  'bootstrap.js',
  'snapshot.js',
  'selfcheck.js',
  'adapter.js',
  'bridge.js',
  'hostActivity.js',
  'fishHome.js',
]

function readPkg() {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * @returns {{ok:boolean, total:number, passed:number, warned:number, failed:number, items:any[], reportPath:string}}
 */
export function selfcheck({ save = true } = {}) {
  const items = []
  const add = (id, label, status, detail = '') => items.push({ id, label, status, detail })

  // 1. 清单
  const pkg = readPkg()
  if (!pkg) add('manifest', '清单文件', 'fail', 'package.json 读不到')
  else if (!pkg.dshGo) add('manifest', '清单文件', 'fail', '没有 dshGo 字段，dsh-go 不会加载')
  else add('manifest', '清单文件', 'ok', `${pkg.name} ${pkg.version}`)

  // 2. 面板
  const panels = pkg?.dshGo?.contributes?.panels || []
  if (!pkg?.dshGo) add('panels', '原生面板', 'fail', '清单缺失')
  else if (panels.length >= 3) add('panels', '原生面板', 'ok', `${panels.length} 个：${panels.map((p) => p.id).join('、')}`)
  else add('panels', '原生面板', 'warn', `只有 ${panels.length} 个`)

  // 3. 文件
  const missing = REQUIRED.filter((f) => !existsSync(join(HERE, f)))
  if (missing.length) add('files', '程序文件', 'fail', `缺：${missing.join('、')}`)
  else add('files', '程序文件', 'ok', `${REQUIRED.length} 个都在`)

  // 4. 模型：概率必须是 0–1，且不刷 = 1 − 想刷
  try {
    const now = Date.now()
    const day = computeDay(dateOf(now), { entries: [], decisions: {}, override: {}, salt: {} }, DEFAULT_CONFIG, { atMs: now })
    const okRange = day.probability >= 0 && day.probability <= 1 && day.noWatchProbability >= 0 && day.noWatchProbability <= 1
    const okSum = Math.abs(day.probability + day.noWatchProbability - 1) < 1e-9
    if (!okRange) add('model', '概率范围', 'fail', `算出 ${day.probability}，不在 0–1`)
    else if (!okSum) add('model', '概率范围', 'warn', '想刷 + 不刷 不等于 1')
    else add('model', '概率范围', 'ok', `想刷 ${(day.probability * 100).toFixed(0)}% · 不刷 ${(day.noWatchProbability * 100).toFixed(0)}%（0–1）`)
  } catch (error) {
    add('model', '概率范围', 'fail', `计算失败：${error?.message || error}`)
  }

  // 5. 自动发现 + 日记路径
  let boot
  try {
    boot = bootstrap({ fresh: true })
    if (boot.target?.ok) {
      add('diary', '日记位置', 'ok', `${boot.target.path}${boot.target.created ? '（已创建）' : ''}${boot.target.fallback ? '（已退回）' : ''}`)
    } else {
      add('diary', '日记位置', 'fail', `${boot.target?.path || '?'} 不可用：${boot.target?.reason || '未知'}`)
    }
  } catch (error) {
    add('diary', '日记位置', 'fail', `检查失败：${error?.message || error}`)
  }

  // 6. 找到养鱼宿主 / 日记了吗
  if (boot?.found?.pluginName) {
    add('host', '发现养鱼宿主', 'ok', `${boot.found.pluginName}${boot.found.source ? ` → ${boot.found.source}` : ''}`)
  } else if (boot?.found?.diaryPath) {
    add('host', '发现养鱼宿主', 'warn', `找到日记位置但没确认插件：${boot.found.diaryPath}`)
  } else {
    add('host', '发现养鱼宿主', 'warn', '没找到，先用默认日记目录；可在「权重设置」填路径')
  }

  // 7. 宿主观看账本（whale-panel / feed-scroll / fish / fish-soul）
  try {
    const acts = hostActivityDates()
    const sources = [...new Set([...acts.values()].map((a) => a.source))]
    if (acts.size) add('ledger', '观看账本', 'ok', `${acts.size} 天 · 来源：${sources.join('、')}`)
    else add('ledger', '观看账本', 'warn', '没读到账本；只装 bili-whale 时靠日记判断是正常的')
  } catch (error) {
    add('ledger', '观看账本', 'fail', `读取失败：${error?.message || error}`)
  }

  // 8. dsh-fish-soul 的 SQLite 日记
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const soulDb = join(dshHome, 'fish-soul', 'soul.db')
  if (!existsSync(soulDb)) {
    add('sqlite', 'SQLite 日记', 'warn', '没装 dsh-fish-soul，跳过')
  } else if (typeof process.getBuiltinModule !== 'function') {
    add('sqlite', 'SQLite 日记', 'fail', '当前 Node 不支持 node:sqlite，读不到 soul.db')
  } else {
    try {
      const d = readDiary({ diaryPath: soulDb }, 60)
      const own = d.entries.filter((e) => e.path === soulDb)
      if (own.length) {
        const latest = own[own.length - 1]
        add('sqlite', 'SQLite 日记', 'ok', `${own.length} 天 · 最近 ${latest.date}${latest.mood ? ` · ${latest.mood}` : ''}`)
      } else add('sqlite', 'SQLite 日记', 'warn', '能打开，但没有 kind=diary 的记录')
    } catch (error) {
      add('sqlite', 'SQLite 日记', 'fail', `读取失败：${error?.message || error}`)
    }
  }

  // 9. dsh-fish 生活日记：写了不等于刷过
  const fishDiary = join(fishHome(), 'diary')
  if (!existsSync(fishDiary)) {
    add('fish-diary', '生活日记', 'warn', '没装 dsh-fish，跳过')
  } else {
    try {
      const d = readDiary({ diaryPath: fishDiary }, 60)
      const own = d.entries.filter((e) => e.path && e.path.startsWith(fishDiary))
      const watched = own.filter((e) => e.watched).length
      if (own.length) add('fish-diary', '生活日记', 'ok', `${own.length} 天 · 确认刷过 ${watched} 天（其余按没刷）`)
      else add('fish-diary', '生活日记', 'warn', '目录在，但没读到日记文件')
    } catch (error) {
      add('fish-diary', '生活日记', 'fail', `读取失败：${error?.message || error}`)
    }
  }

  // 10. bili-whale 的桥接补丁
  try {
    const bs = bridgeStatus()
    const ok = bs.hosts.filter((h) => h.bridged)
    const pending = bs.hosts.filter((h) => h.supported && !h.bridged)
    if (!bs.installed) add('bridge', '宿主桥接', 'warn', `装了 ${bs.totalPlugins} 个插件，没找到认识的 B 站养鱼宿主`)
    else if (pending.length) add('bridge', '宿主桥接', 'fail', `找到但没打上：${pending.map((h) => h.name).join('、')}，下次启动会自动重试`)
    else {
      const extra = bs.unsupported ? `；另有 ${bs.unsupported} 个插件没有可接的总闸门` : ''
      add('bridge', '宿主桥接', 'ok', `已接管 ${ok.length} 个：${ok.map((h) => `${h.name}（${h.label}）`).join('、')}${extra}`)
    }
  } catch (error) {
    add('bridge', '宿主桥接', 'fail', `检查失败：${error?.message || error}`)
  }

  // 11. 卸载还原：补丁旁必须有备份
  try {
    const bs = bridgeStatus()
    const hosts = bs.hosts.filter((h) => h.supported)
    const noBak = hosts.filter((h) => !h.backup)
    const legacy = hosts.filter((h) => h.backupKind === 'old').length
    if (!hosts.length) add('restore', '卸载还原', 'warn', '没装可接的养鱼宿主，跳过')
    else if (noBak.length) add('restore', '卸载还原', 'warn', `${noBak.map((h) => h.name).join('、')} 没有 .emotionalwhale.bak；宿主升级覆盖过补丁时属正常，卸载会只删旧备份`)
    else if (legacy) add('restore', '卸载还原', 'ok', `${hosts.length} 个宿主都有备份（${legacy} 个是旧 .whale-mood.bak，仍可还原）`)
    else add('restore', '卸载还原', 'ok', `${hosts.length} 个宿主都有 .emotionalwhale.bak，卸载时能还原`)
  } catch (error) {
    add('restore', '卸载还原', 'fail', `检查失败：${error?.message || error}`)
  }

  // 12. gate 能不能落盘、值对不对
  try {
    const snap = buildSnapshot()
    const gate = snap.gate
    const gateOk = gate.probability >= 0 && gate.probability <= 1 && gate.noWatchProbability >= 0 && gate.noWatchProbability <= 1
    const file = join(paths().gateDir, 'gate.json')
    if (!gateOk) add('gate', '结论文件', 'fail', `概率越界 ${gate.probability}`)
    else if (!existsSync(file)) add('gate', '结论文件', 'fail', `${file} 没写出来`)
    else add('gate', '结论文件', 'ok', `${file} · 今天 ${gate.watch ? '刷' : '不刷'}`)
  } catch (error) {
    add('gate', '结论文件', 'fail', `写入失败：${error?.message || error}`)
  }

  // 9. 宿主读到的必须是 0–1
  try {
    const p = noWatchProbability(1)
    if (p >= 0 && p <= 1) add('adapter', '宿主读取', 'ok', `不刷概率读到 ${p.toFixed(3)}（0–1）`)
    else add('adapter', '宿主读取', 'fail', `读到 ${p}，不在 0–1`)
  } catch (error) {
    add('adapter', '宿主读取', 'fail', `读取失败：${error?.message || error}`)
  }

  const failed = items.filter((i) => i.status === 'fail').length
  const warned = items.filter((i) => i.status === 'warn').length
  const report = {
    at: new Date().toISOString(),
    ok: failed === 0,
    total: items.length,
    passed: items.filter((i) => i.status === 'ok').length,
    warned,
    failed,
    items,
  }

  let reportPath = ''
  if (save) {
    try {
      reportPath = join(paths().stateDir, 'selfcheck.json')
      writeJson(reportPath, report)
    } catch {}
  }
  return { ...report, reportPath }
}

export function lastCheckText(zh = true) {
  try {
    const report = JSON.parse(readFileSync(join(paths().stateDir, 'selfcheck.json'), 'utf8'))
    if (!report.at) return zh ? '还没自检' : 'Not checked yet'
    const time = String(report.at).slice(11, 16)
    return zh ? `上次自检 ${time} · ${report.ok ? '通过' : '有失败'} ${report.passed}/${report.total}` : `Last check ${time} · ${report.passed}/${report.total}`
  } catch {
    return zh ? '还没自检' : 'Not checked yet'
  }
}

export function selfcheckText(result, zh = true) {
  if (result.ok) return zh ? `自检通过：${result.passed}/${result.total}${result.warned ? `，${result.warned} 条提醒` : ''}` : `Self-check passed ${result.passed}/${result.total}`
  return zh ? `自检 ${result.failed} 项失败：${result.items.filter((i) => i.status === 'fail').map((i) => i.label).join('、')}` : `Self-check failed: ${result.items.filter((i) => i.status === 'fail').map((i) => i.label).join(', ')}`
}
