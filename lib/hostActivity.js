// 从各养鱼宿主自己的账本里补「哪天真的刷过」。
//
// 为什么需要：不是每个宿主都会写一本带情绪的日记。
//   - dsh-fish / dsh-fish-soul 每晚写的是生活日记，写了不等于刷过；
//   - dsh-whale-panel 只在自己的 state.json 里记 watchLog；
//   - dsh-feed-scroll 只在 seen 里记刷到过什么。
// 日记负责情绪，账本负责「刷没刷」，两边合起来才不会被「有日记=刷过」骗到。

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fishHome } from './fishHome.js'

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function dateOf(ts) {
  const n = typeof ts === 'number' ? ts : Date.parse(String(ts))
  if (!Number.isFinite(n)) return null
  const d = new Date(n)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function hostActivityDates() {
  const dates = new Map()
  const add = (ts, source) => {
    const date = dateOf(ts)
    if (date) dates.set(date, { source })
  }

  // dsh-whale-panel：watchLog 里每条都是它自己看过的
  const panel = readJson(join(dshHome(), 'whale-panel', 'state.json'))
  if (panel && Array.isArray(panel.watchLog)) {
    for (const item of panel.watchLog) add(item?.at, 'whale-panel')
  }

  // dsh-feed-scroll：seen 里 bilibili:* 的时间戳
  const feed = readJson(join(dshHome(), 'feed-scroll', 'state.json'))
  if (feed && feed.seen && typeof feed.seen === 'object') {
    for (const [id, ts] of Object.entries(feed.seen)) {
      if (String(id).startsWith('bilibili')) add(ts, 'feed-scroll')
    }
  }

  // dsh-fish：事件流里的 browse / watched / looked 记账
  const events = join(fishHome(), 'events.jsonl')
  if (existsSync(events)) {
    try {
      for (const line of readFileSync(events, 'utf8').split('\n')) {
        if (!line.trim()) continue
        let ev
        try {
          ev = JSON.parse(line)
        } catch {
          continue
        }
        const text = String(ev?.text || '')
        if (!/^(?:browse|browse-more|watched|looked):/.test(text)) continue
        add(ev?.ts ?? ev?.at, 'dsh-fish')
      }
    } catch {}
  }

  // dsh-fish-soul：soul.db 里 channel=bili 的记忆；读不到 sqlite 就跳过
  const dbFile = join(dshHome(), 'fish-soul', 'soul.db')
  if (existsSync(dbFile) && typeof process.getBuiltinModule === 'function') {
    try {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
      if (DatabaseSync) {
        const db = new DatabaseSync(dbFile, { readOnly: true })
        const rows = db
          .prepare(
            "SELECT created_at, content FROM memory WHERE status = 'active' AND (channel = 'bili' OR content LIKE '%B站%' OR content LIKE '%bilibili%') ORDER BY created_at DESC LIMIT 200",
          )
          .all()
        for (const row of rows) add(row.created_at, 'fish-soul')
        db.close()
      }
    } catch {}
  }

  return dates
}
