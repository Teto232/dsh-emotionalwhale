import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { applyBridge } = await import('../lib/bridge.js')

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'whale-host-'))
  for (const [rel, text] of Object.entries(files)) {
    const f = join(dir, rel)
    mkdirSync(join(f, '..'), { recursive: true })
    writeFileSync(f, text, 'utf8')
  }
  return dir
}

test('dsh-bili-scroll：自动 tick 前加闸', () => {
  const dir = fixture({
    'package.json': JSON.stringify({ name: 'dsh-bili-scroll' }),
    'index.js': `import { existsSync, readFileSync } from 'node:fs'\nimport { join } from 'node:path'\nconst cfg = {}\nconst refreshCfg = () => {}\nconst tick = () => {\n  try {\n    refreshCfg() // 每跳重读\n    if (!cfg.peakValley) return\n  } catch {}\n}\n`,
  })
  const r = applyBridge(dir)
  assert.equal(r.ok, true)
  assert.equal(r.hostId, 'bili-scroll')
  assert.ok(existsSync(`${r.file}.emotionalwhale.bak`))
  assert.match(r.file && readFileSync(r.file, 'utf8'), /if \(moodSkipToday\(\)\) return/)
  assert.equal(applyBridge(dir).already, true)
})

test('dsh-fish：quietBrowse / lookBeforeWake 两处都加闸', () => {
  const dir = fixture({
    'package.json': JSON.stringify({ name: '@ssamurias/dsh-fish' }),
    'lib/scheduler.js': `import { join } from 'node:path'\nfunction biliOn(c) { return true }\nexport async function quietBrowse(root, config, deps = {}) {\n  const no = (note) => ({ ok: false, picks: [], note })\n  if (!biliOn(config)) return no('现在上不了网')\n  return { ok: true }\n}\nexport function lookBeforeWake(root, model, config, deps = {}) {\n  const empty = { text: '', picks: [] }\n  if (!config?.browse?.enabled) return empty\n  return empty\n}\n`,
  })
  const r = applyBridge(dir)
  assert.equal(r.ok, true)
  assert.equal(r.hostId, 'dsh-fish')
  const text = readFileSync(r.file, 'utf8')
  assert.match(text, /deps\.force !== true && moodSkipToday\(\)/)
  assert.match(text, /deps\.forceBrowse !== true && moodSkipToday\(\)/)
  assert.equal(applyBridge(dir).already, true)
})

test('dsh-fish-soul：刷一轮前加闸', () => {
  const dir = fixture({
    'package.json': JSON.stringify({ name: '@Britneycode/dsh-fish-soul' }),
    'lib/browse.js': `const getKv = () => null\nconst setKv = () => {}\nexport class BiliBrowser {\n\tasync run({ count } = {}) {\n\t\tif (this.running) return { ok: false, error: '正在刷，稍等' };\n\t\tthis.running = true;\n\t\treturn { ok: true, watched: [] };\n\t}\n}\n`,
  })
  const r = applyBridge(dir)
  assert.equal(r.ok, true)
  assert.equal(r.hostId, 'fish-soul')
  const text = readFileSync(r.file, 'utf8')
  assert.match(text, /if \(moodSkipToday\(\)\) return \{ ok: false, error: '今天不想刷视频' \}/)
  assert.equal(applyBridge(dir).already, true)
})

test('dsh-whale-panel：自动巡航前加闸', () => {
  const dir = fixture({
    'package.json': JSON.stringify({ name: 'dsh-whale-panel' }),
    'index.js': `// whale-panel/api 看板，用 nextRunAt 记下一拍\nimport fs from 'node:fs/promises'\nimport path from 'node:path'\nimport os from 'node:os'\nconst state = {}\nconst loadState = async () => state\nconst run = async () => {\n  const state = await loadState()\n  if (!state.autoRun || state.paused) return\n}\n`,
  })
  const r = applyBridge(dir)
  assert.equal(r.ok, true)
  assert.equal(r.hostId, 'whale-panel')
  assert.match(readFileSync(r.file, 'utf8'), /await moodSkipToday\(\)/)
  assert.equal(applyBridge(dir).already, true)
})

test('dsh-feed-scroll：定时刷帖前加闸，非 B站源不受影响', () => {
  const dir = fixture({
    'package.json': JSON.stringify({ name: 'dsh-feed-scroll' }),
    'index.js': `import { readFileSync } from 'node:fs'\nimport { homedir } from 'node:os'\nimport { join } from 'node:path'\nexport async function runWatchTick(agents, { state }) {\n  for (const target of Object.values(state.targets)) {\n    const watch = target.watch\n    if (!watch || watch.enabled === false) continue\n    // wake agent\n  }\n}\n`,
  })
  const r = applyBridge(dir)
  assert.equal(r.ok, true)
  assert.equal(r.hostId, 'feed-scroll')
  const text = readFileSync(r.file, 'utf8')
  assert.match(text, /watch\.source.*bilibili.*moodSkipToday\(\)\) continue/)
  assert.match(text, /function moodSkipToday\(\)/)
})
