// 从 bili-whale 写的日记里拿两样东西：
//   1. 哪些天刷过（连刷、断更、历史都从这里来，不用自己再记一份）
//   2. 最近几天刷到了什么后劲（伤感/感动…，用来算今天的概率）
//
// 不猜死格式：支持 md / txt / json / jsonl，日期从文件名、frontmatter 或正文里找，
// 找不到就用文件修改时间。路径可以在「权重设置」里指定，也可以自动找几个常见位置。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { dateOf, dayStart } from './model.js'
import { resolveDiaryTarget } from './diaryPath.js'
import { hostActivityDates } from './hostActivity.js'

const EXTS = new Set(['.md', '.markdown', '.txt', '.json', '.jsonl', '.db'])
// 生活日记：每晚都写，写没写不等于刷没刷；要结合宿主账本或正文证据
const LIFE_DIARY = /\.dsh-fish[\\/]diary|soul\.db$|fish-soul.*\.db$/i
const MAX_FILES = 60

const MOOD_WORDS = [
  // 否定式先放最前，避免「不开心」被 happy 抢先命中
  [/不(?:开心|高兴|快乐)|没(?:什么|有)?(?:开心|劲)/, 'sad'],
  [/感动|泪目|热泪|眼眶(?:一热|发热|湿)|鼻(?:子|头)?(?:一酸|发酸)|哽咽|被打动|触动|感慨|唏嘘|震撼/, 'moved'],
  [/治愈|温暖|暖心|被暖到|被安慰|安心|踏实|窝心|释然|松了口气|放松|安稳/, 'healed'],
  [/上头|停不下来|一口气|刷到凌晨|入迷|沉迷|追更/, 'hooked'],
  [/开心|高兴|快乐|笑死|好笑|逗乐|愉快|雀跃|兴奋|满足|幸福|美滋滋|嘴角上扬|爽|不错|挺好|好看|喜欢|轻松/, 'happy'],
  [/生气|愤怒|气死|火大|恼火|气愤|离谱|无语/, 'angry'],
  [/后怕|害怕|吓到|恐怖|毛骨悚然|细思极恐|心惊/, 'scared'],
  [/平淡|无聊|没意思|麻木|没什么感觉|一般般/, 'flat'],
  [/emo|难过|伤感|伤心|想哭|破防|失落|空虚|惆怅|低落|沮丧|压抑|难受|心疼|遗憾|空落|孤独|委屈|郁闷|烦|丧|心里堵|堵得慌|不是滋味|酸楚|提不起劲|没劲|心累|疲惫|后劲|没缓过来|缓不过来/, 'sad'],
]

function watchedSignal(text) {
  const t = String(text || '')
  // bili-whale 在不刷的日子也会写一段「本轮【不看】」的解释
  if (/【\s*(?:不看|不刷)\s*】/.test(t)) return false
  if (/【\s*(?:看|刷)\s*】/.test(t)) return true
  if (/(?:本轮|今天|这次|本次|结果|最终)[^\n。！？]{0,30}(?:不看|不刷|没看|没刷|不想看|不想刷|懒得看|懒得刷)/.test(t)) return false
  if (/^\s*(?:没有|没)(?:看|刷)/m.test(t)) return false
  if (/跳过|今天休息|今日休息/.test(t)) return false
  // 生活日记里明确写了刷到/看了什么，也算刷过
  if (/(?:刷到|刷了|看了|追了|打开B站|逛了B站|B站上)/i.test(t)) return true
  return null
}

function watchedFromText(text) {
  return watchedSignal(text) ?? true
}

function dateFromName(name) {
  const m = name.match(/(20\d{2})[-_.年](\d{1,2})[-_.月](\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
}

function dateFromText(text) {
  const m = text.slice(0, 400).match(/(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/)
  if (!m) return null
  const d = `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

const MOOD_ALIASES = {
  伤感: 'sad', 难过: 'sad', 低落: 'sad', 平静: 'flat', 平淡: 'flat', 无聊: 'flat',
  治愈: 'healed', 温暖: 'healed', 感动: 'moved', 开心: 'happy', 快乐: 'happy',
  生气: 'angry', 后怕: 'scared', 害怕: 'scared', 上头: 'hooked', emo: 'emo',
}

const MOOD_IDS = ['sad', 'emo', 'angry', 'scared', 'flat', 'healed', 'moved', 'happy', 'hooked']

function normalizeMood(raw) {
  if (raw === null || raw === undefined) return null
  const value = String(raw).trim().toLowerCase()
  if (!value) return null
  if (MOOD_IDS.includes(value)) return value
  return MOOD_ALIASES[value] || null
}

function moodFromText(text) {
  const explicit = text.match(/mood\s*[:：]\s*["']?([a-zA-Z]+|[\u4e00-\u9fa5]{1,4})/i)
  if (explicit) {
    const mood = normalizeMood(explicit[1])
    if (mood) return mood
  }
  for (const [re, id] of MOOD_WORDS) if (re.test(text)) return id
  return null
}

function intensityFromText(text) {
  const m = text.match(/强度\s*[:：]?\s*(\d+(?:\.\d+)?)/)
  if (!m) return 0.6
  const n = Number(m[1])
  if (!Number.isFinite(n)) return 0.6
  return n > 1 ? Math.min(1, n / 100) : Math.min(1, Math.max(0, n))
}

function makeEntry(fields, fallbackDate, path) {
  const text = String(fields.text || '')
  const date = fields.date && /^\d{4}-\d{2}-\d{2}$/.test(fields.date) ? fields.date : dateFromText(text) || fallbackDate
  if (!date) return null
  // 字段里的中文情绪名也要归一化，不能只认正文里的 mood: xxx
  const mood = normalizeMood(fields.mood) || moodFromText(text)
  const intensity = Number.isFinite(Number(fields.intensity))
    ? Number(fields.intensity) > 1
      ? Math.min(1, Number(fields.intensity) / 100)
      : Math.min(1, Math.max(0, Number(fields.intensity)))
    : intensityFromText(text)
  const ts = Number(fields.ts)
  const when = Number.isFinite(ts) && ts > 0 ? ts : dayStart(date) + 20 * 3_600_000
  const note = String(fields.note || fields.title || text.replace(/[#*`>]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 120)
  const signal = watchedSignal(text)
  let watched = signal ?? true
  if (fields.watched === false || fields.skip === true || fields.watch === false) watched = false
  if (fields.watched === true || fields.watch === true) watched = true
  // 生活日记每晚都写：正文没提 B站/刷视频，就不当成「今天刷过」；
  // 真正的观看记录由 hostActivity.js 的账本补进来。
  if (LIFE_DIARY.test(String(path)) && signal === null) watched = false
  // 不刷 + 明确低情绪 / 「后劲还没缓过来」：这是被后劲拖住，不是普通休息
  const moodPause =
    !watched &&
    (['sad', 'emo', 'angry', 'scared', 'flat'].includes(mood) || /后劲|没缓过来|缓不过来|还没缓/.test(text))
  return { date, ts: when, mood, intensity, note, path, watched, moodPause, watchedExplicit: signal !== null }
}

function parseJsonFile(text, fallbackDate, path) {
  const out = []
  if (text.trim() === '') return out
  try {
    const data = JSON.parse(text)
    const list = Array.isArray(data) ? data : Array.isArray(data.entries) ? data.entries : [data]
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      out.push(
        makeEntry(
          {
            date: item.date || item.day,
            ts: item.ts || item.time || item.created_at,
            mood: item.mood || item.emotion,
            intensity: item.intensity || item.strength,
            note: item.note || item.title,
            title: item.title,
            watched: item.watched ?? item.watch,
            skip: item.skip,
            text: [item.title, item.summary, item.content, item.text].filter(Boolean).join('\n'),
          },
          fallbackDate,
          path,
        ),
      )
    }
  } catch {
    return []
  }
  return out.filter(Boolean)
}

function parseJsonlFile(text, fallbackDate, path) {
  const out = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const item = JSON.parse(trimmed)
      out.push(
        makeEntry(
          {
            date: item.date,
            ts: item.ts,
            mood: item.mood,
            intensity: item.intensity,
            note: item.note,
            watched: item.watched ?? item.watch,
            skip: item.skip,
            text: [item.title, item.text, item.content].filter(Boolean).join('\n'),
          },
          fallbackDate,
          path,
        ),
      )
    } catch {}
  }
  return out.filter(Boolean)
}

function headingDate(line) {
  const m = line.match(/^\s{0,3}#{1,6}\s*(?:[【\[(（])?\s*(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
}

function parseTableRows(text, path) {
  const rows = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    if (/^\|\s*(?:---|:?-{2,})/.test(trimmed)) continue
    if (/\|\s*时间\s*\|/.test(trimmed)) continue
    const m = trimmed.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/)
    if (!m) continue
    const date = `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
    const cells = trimmed.replace(/^\||\|$/g, '').split('|').map((x) => x.trim())
    const note = cells.find((x, i) => i >= 2 && x && !/^\d{4}-/.test(x)) || ''
    // 表格行也要走「【不看】/没看/不刷」判断，不能默认算刷过
    const status = cells.find((c) => /^【?(?:不看|不刷|没看|没刷|跳过)】?$/.test(c))
    const entry = makeEntry({ date, note, text: cells.join(' '), watched: status ? false : undefined }, null, path)
    if (entry) rows.push(entry)
  }
  return rows
}

function parseTextFile(text, fallbackDate, path) {
  if (text.trim() === '') return []
  const fm = text.match(/^---\n([\s\S]*?)\n---/)
  const fields = {}
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const kv = line.match(/^([A-Za-z_]+)\s*:\s*(.*)$/)
      if (kv) fields[kv[1].toLowerCase()] = kv[2].replace(/["']/g, '').trim()
    }
  }

  // 1) bili-whale 的「## 看过」表格：日期在每一行，日期标题可能是别的
  const tableRows = parseTableRows(text, path)

  // 2) 一个文件里按「## 2026-11-08」分多天写：每天单独切一段
  const sections = []
  let current = null
  for (const line of text.split('\n')) {
    const date = headingDate(line)
    if (date) {
      current = { date, lines: [line] }
      sections.push(current)
      continue
    }
    if (current) current.lines.push(line)
  }
  if (sections.length) {
    const byDate = new Map()
    for (const sec of sections) {
      const entry = makeEntry({ date: sec.date, text: sec.lines.join('\n') }, null, path)
      if (entry) byDate.set(entry.date, entry)
    }
    // 同一天的表格行补情绪，但不推翻「【不看】」这种明确标记
    for (const row of tableRows) {
      const prev = byDate.get(row.date)
      if (!prev) byDate.set(row.date, row)
      else if (!prev.mood && row.mood) prev.mood = row.mood
    }
    return [...byDate.values()]
  }

  // 3) 只有「## 看过」表格：每行一条
  if (tableRows.length) return tableRows

  const titleLine = text.split('\n').find((l) => l.trim().startsWith('# '))
  return [
    makeEntry(
      {
        date: fields.date,
        ts: fields.ts,
        mood: fields.mood,
        intensity: fields.intensity,
        note: fields.note || titleLine?.replace(/^#\s*/, ''),
        text,
      },
      fallbackDate,
      path,
    ),
  ].filter(Boolean)
}

function parseSqliteFile(file, fallbackDate) {
  if (typeof process.getBuiltinModule !== 'function') return []
  let db
  try {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    if (!DatabaseSync) return []
    db = new DatabaseSync(file, { readOnly: true })
    const rows = db
      .prepare(
        "SELECT content, created_at FROM memory WHERE status = 'active' AND kind = 'diary' ORDER BY created_at ASC LIMIT 200",
      )
      .all()
    const out = []
    for (const row of rows) {
      const content = String(row?.content || '').trim()
      if (!content) continue
      const m = content.match(/^(20\d{2}-\d{2}-\d{2})\s*的日记[:：]\s*/)
      const date = m ? m[1] : dateOf(row?.created_at) || fallbackDate
      const text = content.replace(/^20\d{2}-\d{2}-\d{2}\s*的日记[:：]\s*/, '')
      const entry = makeEntry({ date, text, ts: row?.created_at }, date, file)
      if (entry) out.push(entry)
    }
    return out
  } catch {
    return []
  } finally {
    try {
      db?.close()
    } catch {}
  }
}

function readOne(file) {
  const fallbackDate = dateFromName(basename(file)) || dateOf(statSync(file).mtimeMs)
  const ext = extname(file).toLowerCase()
  if (ext === '.db') return parseSqliteFile(file, fallbackDate)
  const text = readFileSync(file, 'utf8')
  if (ext === '.json') return parseJsonFile(text, fallbackDate, file)
  if (ext === '.jsonl') return parseJsonlFile(text, fallbackDate, file)
  return parseTextFile(text, fallbackDate, file)
}

function listFiles(target) {
  if (!existsSync(target)) return []
  const st = statSync(target)
  if (st.isFile()) return EXTS.has(extname(target).toLowerCase()) ? [target] : []
  const files = []
  for (const name of readdirSync(target)) {
    const file = join(target, name)
    try {
      const s = statSync(file)
      const ext = extname(name).toLowerCase()
      if (s.isFile() && EXTS.has(ext) && (ext !== '.db' || /soul\.db$/i.test(name))) files.push({ file, mtime: s.mtimeMs })
    } catch {}
  }
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_FILES).map((f) => f.file)
}

/**
 * 读日记。返回 { found, path, entries, dates, latest }。
 * entries 按日期升序；同一天有多份就取修改时间最新的那份。
 */
export function readDiary(cfg, limit = 60) {
  const target = resolveDiaryTarget(cfg)
  const byDate = new Map()
  for (const file of listFiles(target.path)) {
    let parsed = []
    try {
      parsed = readOne(file)
    } catch {}
    for (const entry of parsed) {
      const prev = byDate.get(entry.date)
      if (!prev || entry.ts >= prev.ts) byDate.set(entry.date, entry)
    }
  }
  // 日记负责情绪，宿主账本负责「哪天真的刷过」；账本只在日记没写清楚时补
  const activity = hostActivityDates()
  for (const [date, info] of activity) {
    const prev = byDate.get(date)
    if (!prev) {
      const entry = makeEntry({ date, text: '', watched: true, note: `宿主观看记录（${info.source}）` }, date, 'activity')
      if (entry) byDate.set(date, entry)
    } else if (!(prev.watchedExplicit && prev.watched === false)) {
      prev.watched = true
      prev.moodPause = false
    }
  }
  const entries = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-limit)
  return {
    found: entries.length > 0,
    path: target.path,
    target,
    entries,
    dates: entries.map((e) => e.date),
    latest: entries[entries.length - 1] || null,
  }
}
