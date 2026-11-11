import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDiary } from '../lib/diary.js'

function dir() {
  return mkdtempSync(join(tmpdir(), 'whale-diary-'))
}

test('读 md：日期从文件名，情绪从关键词', () => {
  const d = dir()
  writeFileSync(join(d, '2026-11-07.md'), '# 今天\n刷到一个治愈的视频，很温暖。', 'utf8')
  const diary = readDiary({ diaryPath: d })
  assert.equal(diary.found, true)
  assert.deepEqual(diary.dates, ['2026-11-07'])
  assert.equal(diary.latest.mood, 'healed')
  assert.ok(diary.latest.intensity > 0)
})

test('读 json：显式字段优先，强度 0–100 会折成 0–1', () => {
  const d = dir()
  writeFileSync(join(d, 'diary.json'), JSON.stringify({ date: '2026-11-08', mood: 'sad', intensity: 80, note: '看哭了' }), 'utf8')
  const diary = readDiary({ diaryPath: join(d, 'diary.json') })
  assert.equal(diary.latest.date, '2026-11-08')
  assert.equal(diary.latest.mood, 'sad')
  assert.equal(diary.latest.intensity, 0.8)
  assert.equal(diary.latest.note, '看哭了')
})

test('同一天多份取最新，多天按日期升序', () => {
  const d = dir()
  writeFileSync(join(d, '2026-11-07.md'), '今天有点 emo，提不起劲。', 'utf8')
  writeFileSync(join(d, '2026-11-08.md'), '今天很上头，一口气刷到凌晨。', 'utf8')
  writeFileSync(join(d, '2026-11-08-补.md'), '2026-11-08 补记：其实后来有点后怕。', 'utf8')
  const diary = readDiary({ diaryPath: d })
  assert.deepEqual(diary.dates, ['2026-11-07', '2026-11-08'])
  assert.ok(['hooked', 'scared'].includes(diary.latest.mood))
})

test('一个 md 里用 ## 日期分多天，逐段解析', () => {
  const d = dir()
  writeFileSync(
    join(d, 'whale-diary.md'),
    '# 鲸鱼日记\n\n## 2026-11-08\n鼻子一酸，有点伤感。mood: sad\n\n## 2026-11-09\n被治愈到了。mood: healed\n\n## 2026-11-10\n笑死，很开心。mood: happy\n',
    'utf8',
  )
  const diary = readDiary({ diaryPath: join(d, 'whale-diary.md') })
  assert.deepEqual(diary.dates, ['2026-11-08', '2026-11-09', '2026-11-10'])
  assert.equal(diary.latest.date, '2026-11-10')
  assert.equal(diary.latest.mood, 'happy')
  assert.equal(diary.entries.find((e) => e.date === '2026-11-08').mood, 'sad')
})

test('「## 看过」表格按行拆日期', () => {
  const d = dir()
  writeFileSync(
    join(d, 'whale-diary.md'),
    '## 看过\n| 时间 | BV | 标题 | 简介 | 想法 |\n| --- | --- | --- | --- | --- |\n| 2026-11-08 | BV1xx | 测试标题 | 简介 | 鼻子一酸 |\n| 2026-11-10 | BV1yy | 另一个 | 简介 | 笑死 |\n\n## 2026-11-09\n本轮【不看】。\n',
    'utf8',
  )
  const diary = readDiary({ diaryPath: join(d, 'whale-diary.md') })
  assert.deepEqual(diary.dates, ['2026-11-08', '2026-11-09', '2026-11-10'])
  assert.equal(diary.entries.find((e) => e.date === '2026-11-09').watched, false)
  assert.equal(diary.entries.find((e) => e.date === '2026-11-10').mood, 'happy')
})

test('字段里的中文情绪名也归一化', () => {
  const d = dir()
  const cn = join(d, 'cn.md')
  const en = join(d, 'en.md')
  writeFileSync(cn, '---\ndate: 2026-11-08\nmood: 难过\nintensity: 0.8\n---\n', 'utf8')
  writeFileSync(en, '---\ndate: 2026-11-08\nmood: sad\nintensity: 0.8\n---\n', 'utf8')
  const a = readDiary({ diaryPath: cn }).latest
  const b = readDiary({ diaryPath: en }).latest
  assert.equal(a.mood, 'sad')
  assert.equal(a.mood, b.mood)
  assert.equal(a.intensity, b.intensity)
})

test('纯表格日记的【不看】行不算刷过', () => {
  const d = dir()
  writeFileSync(
    join(d, 'whale-diary.md'),
    '## 看过\n| 时间 | BV | 标题 | 简介 | 想法 |\n| --- | --- | --- | --- | --- |\n| 2026-11-08 | BV1xx | 真看了 | 简介 | 还行 |\n| 2026-11-09 | 【不看】 | 今天不想刷 |  |\n',
    'utf8',
  )
  const diary = readDiary({ diaryPath: join(d, 'whale-diary.md') })
  assert.equal(diary.entries.find((e) => e.date === '2026-11-08').watched, true)
  assert.equal(diary.entries.find((e) => e.date === '2026-11-09').watched, false)
})

test('不刷日写的【不看】不算刷过；写了还在后劲里则标成 moodPause', () => {
  const d = dir()
  writeFileSync(
    join(d, 'whale-diary.md'),
    '# 鲸鱼日记\n\n## 2026-11-08\n刷到流浪猫，鼻子一酸。mood: sad\n\n## 2026-11-09\n本轮【不看】。后劲还没缓过来，还是有点伤心。\n\n## 2026-11-10\n本轮【不看】。想再安静一天。\n',
    'utf8',
  )
  const diary = readDiary({ diaryPath: join(d, 'whale-diary.md') })
  assert.equal(diary.dates.length, 3)
  assert.equal(diary.entries.find((e) => e.date === '2026-11-08').watched, true)
  assert.equal(diary.entries.find((e) => e.date === '2026-11-09').watched, false)
  assert.equal(diary.entries.find((e) => e.date === '2026-11-10').watched, false)
  assert.equal(diary.entries.find((e) => e.date === '2026-11-09').moodPause, true)
})

test('正文里带日期也能认出来', () => {
  const d = dir()
  writeFileSync(join(d, 'note.md'), '2026-11-06\n今天被感动到了，眼眶一热。', 'utf8')
  const diary = readDiary({ diaryPath: d })
  assert.equal(diary.latest.date, '2026-11-06')
  assert.equal(diary.latest.mood, 'moved')
})

test('没有日记就老实返回空', () => {
  const diary = readDiary({ diaryPath: join(dir(), '不存在') })
  assert.equal(diary.found, false)
  assert.equal(diary.latest, null)
})

test('读 dsh-fish-soul 的 soul.db 日记', () => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const file = join(dir(), 'soul.db')
  const db = new DatabaseSync(file)
  db.exec("CREATE TABLE memory (kind TEXT, status TEXT, content TEXT, created_at INTEGER)")
  db.prepare("INSERT INTO memory (kind, status, content, created_at) VALUES ('diary', 'active', ?, ?)").run(
    '2026-11-08 的日记：今天刷到几个很有深度的视频，心里有点伤感。',
    new Date(2026, 10, 8, 20).getTime(),
  )
  db.close()
  const diary = readDiary({ diaryPath: file })
  assert.equal(diary.found, true)
  assert.deepEqual(diary.dates, ['2026-11-08'])
  assert.equal(diary.latest.mood, 'sad')
  assert.equal(diary.latest.watched, true)
})

test('生活日记不默认算刷过，宿主账本记了才算', () => {
  const d = mkdtempSync(join(tmpdir(), 'whale-life-'))
  const diaryDir = join(d, '.dsh-fish', 'diary')
  mkdirSync(diaryDir, { recursive: true })
  writeFileSync(join(diaryDir, '2026-11-06.md'), '今天在家收拾屋子，挺平淡的。', 'utf8')
  writeFileSync(join(diaryDir, '2026-11-07.md'), '今天在家收拾屋子，挺平淡的。', 'utf8')
  writeFileSync(join(diaryDir, '2026-11-08.md'), '今天刷到一条视频，看哭了。', 'utf8')
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = join(d, '.dsh')
  mkdirSync(join(d, '.dsh', 'whale-panel'), { recursive: true })
  writeFileSync(
    join(d, '.dsh', 'whale-panel', 'state.json'),
    JSON.stringify({ watchLog: [{ at: new Date(2026, 10, 7, 21).getTime() }] }),
    'utf8',
  )
  const diary = readDiary({ diaryPath: diaryDir })
  if (old === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = old
  assert.equal(diary.entries.find((e) => e.date === '2026-11-06').watched, false)
  assert.equal(diary.entries.find((e) => e.date === '2026-11-07').watched, true)
  assert.equal(diary.entries.find((e) => e.date === '2026-11-08').watched, true)
})
