// 记忆面板回归：
//   1. 30 天数据长度固定
//   2. mood 为 null 的条目不能被整条丢掉（线上 bug 回归）
//   3. 跳过日要明确写「跳过日」，不能空白
//   4. 打开面板不许动日记文件（sha256 + mtime 必须不变）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'whale-memory-'))
process.env.DSH_HOME = home
process.env.WHALE_MOOD_DIR = join(home, 'state')
process.env.WHALE_GATE_DIR = join(home, 'gate')

const diaryDir = join(home, 'whale', 'diary')
mkdirSync(diaryDir, { recursive: true })

function dateStr(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

const diaryFile = join(diaryDir, 'whale-diary.md')
// 日志不放日记目录：.jsonl 会被当作日记解析，反而盖掉当天的情绪
const logFile = join(home, 'state', 'whale-log.jsonl')
mkdirSync(join(home, 'state'), { recursive: true })

const diaryText = [
  '# 鲸鱼日记',
  '',
  `## ${dateStr(-4)}`,
  '今天刷到主人推荐的视频 BV1ab411c7mD，很感动，看哭了。',
  '',
  `## ${dateStr(-3)}`,
  '本轮【不看】今天没时间。',
  '',
  `## ${dateStr(-2)}`,
  '本轮【不看】想早点睡。',
  '',
  `## ${dateStr(0)}`,
  '今天在整理房间，没写心情。',
  '',
].join('\n')

writeFileSync(diaryFile, diaryText, 'utf8')
writeFileSync(logFile, '{"date":"' + dateStr(-4) + '","note":"log"}\n', 'utf8')
// 事先放一份 gate.json：记忆面板不许把它重写掉
mkdirSync(join(home, 'gate'), { recursive: true })
const gateFile = join(home, 'gate', 'gate.json')
writeFileSync(gateFile, '{"sentinel":true}', 'utf8')

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const before = {
  diaryHash: sha(diaryFile),
  diaryMtime: statSync(diaryFile).mtimeMs,
  logHash: sha(logFile),
  logMtime: statSync(logFile).mtimeMs,
  gateHash: sha(gateFile),
  gateMtime: statSync(gateFile).mtimeMs,
}

const { memoryData } = await import('../lib/index.js')
const data = memoryData(true)

test('近 30 天数据固定 30 格，今天有日记就记 1', () => {
  assert.equal(data.cats.length, 30)
  assert.equal(data.values.length, 30)
  assert.equal(data.moodValues.length, 30)
  assert.equal(data.values[29], 1)
  assert.equal(data.cats[29], dateStr(0).slice(5).replace('-', '/'))
})

test('mood 为 null 的条目仍然显示（不再被 filter 掉）', () => {
  assert.equal(data.recent[0].title.includes('没标情绪'), true)
  assert.equal(data.recent[0].tone, 'muted')
  assert.equal(data.stats[0][1].includes('4 天有记录'), true)
})

test('跳过日显示为「跳过日」，不是空白也不是写了', () => {
  const skipRows = data.recent.filter((r) => r.title.includes('跳过日'))
  assert.equal(skipRows.length, 2)
  assert.equal(skipRows[0].title.includes(dateStr(-2).slice(5).replace('-', '/')), true)
  assert.equal(skipRows[1].title.includes(dateStr(-3).slice(5).replace('-', '/')), true)
})

test('遗忘预警：主人与 BV 号按最后一次出现算天数', () => {
  assert.equal(data.metrics.length, 3)
  assert.ok(data.memory.length <= 5)
  const owner = data.memory.find((m) => m.title.includes('主人'))
  assert.ok(owner)
  assert.equal(owner.trailing, '4 天前')
  const bv = data.memory.find((m) => m.title === 'BV1ab411c7mD')
  assert.ok(bv)
  assert.equal(bv.trailing, '4 天没提')
  assert.equal(data.recent[3].title.includes('感动'), true)
})

test('只读：日记、日志、gate.json 的内容与修改时间完全不变', () => {
  assert.equal(sha(diaryFile), before.diaryHash)
  assert.equal(sha(logFile), before.logHash)
  assert.equal(sha(gateFile), before.gateHash)
  assert.equal(statSync(diaryFile).mtimeMs, before.diaryMtime)
  assert.equal(statSync(logFile).mtimeMs, before.logMtime)
  assert.equal(statSync(gateFile).mtimeMs, before.gateMtime)
})
