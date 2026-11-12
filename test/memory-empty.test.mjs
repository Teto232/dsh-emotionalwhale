// 空数据回归：没日记时，「距上次 30 天」不能当报警显示。
// 这里单独一个文件，是因为 diary 路径在模块加载时就固定了，必须独立进程。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'whale-empty-'))
process.env.DSH_HOME = home
process.env.WHALE_MOOD_DIR = join(home, 'state')
process.env.WHALE_GATE_DIR = join(home, 'gate')
mkdirSync(join(home, 'whale', 'diary'), { recursive: true })

const { memoryData } = await import('../lib/index.js')
const data = memoryData(true)

test('空数据：30 天仍固定 30 格，记录数为 0', () => {
  assert.equal(data.values.length, 30)
  assert.equal(data.values.every((v) => v === 0), true)
  assert.equal(data.metrics.length, 3)
})

test('空数据：距上次不显示 30 天，改「还没有记录」且不报警', () => {
  const gap = data.metrics.find((m) => m.label === '距上次')
  assert.ok(gap)
  assert.equal(gap.value, '—')
  assert.equal(gap.caption, '还没有记录')
  assert.equal(gap.tone, 'muted')
})

test('空数据：遗忘预警里的断更条目不报警', () => {
  const gapRow = data.memory.find((m) => m.title === '断更')
  assert.ok(gapRow)
  assert.equal(gapRow.subtitle, '还没有记录')
  assert.equal(gapRow.trailing, '—')
  assert.equal(gapRow.tone, 'muted')
})

test('空数据：提示没找到日记，不白屏', () => {
  assert.equal(data.note.includes('没找到日记'), true)
  assert.equal(data.stats[0][1].includes('0 天有记录'), true)
})
