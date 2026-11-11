import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const home = mkdtempSync(join(tmpdir(), 'whale-bridge-'))
const plugin = join(home, 'plugins', 'bili-whale')
mkdirSync(join(plugin, 'tools', 'lib'), { recursive: true })
writeFileSync(
  join(plugin, 'tools', 'lib', 'night-config.mjs'),
  `import fs from 'node:fs'\nimport path from 'node:path'\nexport const DSH_HOME = process.env.DSH_HOME || ${JSON.stringify(home)}\nexport function readNightConfig(home = DSH_HOME) {\n  return { windows: [], skipChance: 0.3, minGapMin: 10, maxVideos: 5 }\n}\n`,
  'utf8',
)
process.env.DSH_HOME = home

const { applyBridge, isBridged, restoreBridge } = await import('../lib/bridge.js')

test('桥接后宿主从 gate 读 skipChance', async () => {
  const r = applyBridge(plugin)
  assert.equal(r.ok, true)
  assert.equal(r.already, false)
  assert.ok(existsSync(r.backup))
  assert.equal(isBridged(r.file), true)

  mkdirSync(join(home, 'whale'), { recursive: true })
  const today = new Date().toLocaleDateString('sv-SE')
  writeFileSync(join(home, 'whale', 'gate.json'), JSON.stringify({ date: today, noWatchProbability: 0.8 }), 'utf8')

  const mod = await import(pathToFileURL(join(plugin, 'tools', 'lib', 'night-config.mjs')).href)
  assert.equal(mod.readNightConfig().skipChance, 0.8)
})

test('gate 过期就退回原值', async () => {
  writeFileSync(join(home, 'whale', 'gate.json'), JSON.stringify({ date: '2000-01-01', noWatchProbability: 0.9 }), 'utf8')
  const mod = await import(pathToFileURL(join(plugin, 'tools', 'lib', 'night-config.mjs')).href)
  assert.equal(mod.readNightConfig().skipChance, 0.3)
})

test('重复打补丁不会叠加', () => {
  const again = applyBridge(plugin)
  assert.equal(again.ok, true)
  assert.equal(again.already, true)
  const text = readFileSync(join(plugin, 'tools', 'lib', 'night-config.mjs'), 'utf8')
  assert.equal(text.split('MOOD-BRIDGE').length - 1, 1)
})

test('卸载时把宿主还原成打补丁前的原文', () => {
  const file = join(plugin, 'tools', 'lib', 'night-config.mjs')
  const r = restoreBridge(plugin)
  assert.equal(r.ok, true)
  assert.equal(r.changed, 1)
  const text = readFileSync(file, 'utf8')
  assert.ok(!text.includes('MOOD-BRIDGE'))
  assert.ok(text.includes('export function readNightConfig'))
  assert.ok(!existsSync(`${file}.emotionalwhale.bak`))
})

test('旧版 .whale-mood.bak 也能还原', () => {
  const file = join(plugin, 'tools', 'lib', 'night-config.mjs')
  const r = applyBridge(plugin)
  assert.equal(r.ok, true)
  renameSync(`${file}.emotionalwhale.bak`, `${file}.whale-mood.bak`)
  const rr = restoreBridge(plugin)
  assert.equal(rr.ok, true)
  const text = readFileSync(file, 'utf8')
  assert.ok(!text.includes('MOOD-BRIDGE'))
  assert.ok(!existsSync(`${file}.whale-mood.bak`))
})
