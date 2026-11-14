#!/usr/bin/env node
// 命令行入口：给不是 Node ESM、或者只想拿个数字的宿主插件用。
//
//   emotionalwhale --gate            打印今天的完整 gate JSON
//   emotionalwhale --no-watch        只打印「不刷」概率（0–1，1 = 100%）
//   emotionalwhale --watch           只打印「想刷」概率（0–1）
//   emotionalwhale --decide          打印 watch / skip
//   emotionalwhale --diary           打印读到的日记摘要
//   emotionalwhale --force skip|watch|auto
//   emotionalwhale --reroll

import { dateOf, moodLabel } from '../lib/model.js'
import { buildSnapshot } from '../lib/snapshot.js'
import { resolveDiaryTarget } from '../lib/diaryPath.js'
import { bootstrap } from '../lib/bootstrap.js'
import { discoverWhale } from '../lib/discover.js'
import { selfcheck, selfcheckText } from '../lib/selfcheck.js'
import { applyAllBridges, bridgeStatus, restoreAllBridges } from '../lib/bridge.js'
import { bumpSalt } from '../lib/store.js'

const snapshot = () => buildSnapshot()

function help() {
  console.log(
    [
      '用法：',
      '  emotionalwhale --gate            今天的完整 gate JSON',
      '  emotionalwhale --no-watch        不刷概率（0–1，1 = 100%）',
      '  emotionalwhale --watch           想刷概率（0–1）',
      '  emotionalwhale --decide          watch | skip',
      '  emotionalwhale --diary           读到的日记摘要（含路径自检结果）',
      '  emotionalwhale --reroll',
      '  emotionalwhale --bridge         自动给所有养鱼宿主打桥接',
      '  emotionalwhale --restore        卸掉桥接，把宿主还原回原文',
    ].join('\n'),
  )
}

const args = process.argv.slice(2)
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  help()
  process.exit(0)
}

let _snap
const snap = () => _snap || (_snap = snapshot())
const cmd = args[0]

if (cmd === '--gate' || cmd === '--json') {
  console.log(JSON.stringify(snap().gate, null, 2))
} else if (cmd === '--no-watch') {
  console.log(Number(snap().gate.noWatchProbability).toFixed(4))
} else if (cmd === '--watch') {
  console.log(Number(snap().gate.probability).toFixed(4))
} else if (cmd === '--decide') {
  console.log(snap().gate.watch ? 'watch' : 'skip')
} else if (cmd === '--diary') {
  const d = snap().diary
  console.log(
    JSON.stringify(
      {
        found: d.found,
        path: d.path,
        days: d.dates.length,
        target: d.target,
        latest: d.latest
          ? {
              date: d.latest.date,
              mood: d.latest.mood,
              moodLabel: d.latest.mood ? moodLabel(d.latest.mood) : null,
              intensity: d.latest.intensity,
              note: d.latest.note,
              ts: d.latest.ts,
            }
          : null,
      },
      null,
      2,
    ),
  )
} else if (cmd === '--discover') {
  console.log(JSON.stringify(discoverWhale({ fresh: true }), null, 2))
} else if (cmd === '--bootstrap') {
  const r = bootstrap({ fresh: true })
  if (args.includes('--json')) {
    console.log(JSON.stringify({ changed: r.changed, diaryPath: r.cfg.diaryPath, plugin: r.found, target: r.target }, null, 2))
  } else {
    console.log(`插件：${r.found.pluginName || '没找到'}${r.found.pluginDir ? `（${r.found.pluginDir}）` : ''}`)
    console.log(`日记：${r.found.diaryPath || r.cfg.diaryPath || '用默认目录'}`)
    console.log(`配置：${r.changed ? '已写入' : '不用改'}；位置自检：${r.target.ok ? '可用' : '不可用'}${r.target.created ? '（已创建）' : ''}${r.target.fallback ? '（已退回默认）' : ''}`)
  }
} else if (cmd === '--bridge') {
  const results = applyAllBridges()
  if (!results.length) console.log('没找到 B 站养鱼插件，跳过桥接。')
  for (const r of results) {
    if (r.ok && r.already) console.log(`已经打过 [${r.hostId}] ${r.name}：${r.file}`)
    else if (r.ok) console.log(`桥接完成 [${r.hostId}] ${r.name}：${r.file}${r.ui ? '（设置页文案也改了）' : ''}\n  备份：${r.backup}`)
    else console.log(`跳过 ${r.name}：${r.reason}`)
  }
} else if (cmd === '--restore') {
  const results = restoreAllBridges()
  if (results.length === 0) console.log('没有需要还原的宿主')
  else for (const r of results) console.log(`${r.name}: 已还原 ${r.changed} 个文件`)
} else if (cmd === '--bridge-status') {
  console.log(JSON.stringify(bridgeStatus(), null, 2))
} else if (cmd === '--check') {
  const r = selfcheck()
  console.log(JSON.stringify(r, null, 2))
  console.error(selfcheckText(r, true))
  process.exit(r.ok ? 0 : 1)
} else if (cmd === '--path') {
  const target = resolveDiaryTarget(JSON.parse(JSON.stringify({ diaryPath: args[1] || '' })))
  console.log(JSON.stringify(target, null, 2))
} else if (cmd === '--reroll') {
  bumpSalt(dateOf(Date.now()))
  console.log(JSON.stringify(snapshot().gate, null, 2))
} else {
  console.error('不认识的参数：' + cmd)
  help()
  process.exit(2)
}
