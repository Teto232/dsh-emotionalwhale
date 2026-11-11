import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// DSH_HOME 在模块加载时读取，所以先造环境再动态 import
const home = mkdtempSync(join(tmpdir(), 'whale-disc-'))
const plugin = join(home, 'dsh-go', 'plugins', 'bili-whale')
const diary = join(home, 'custom-diary')
mkdirSync(join(plugin, 'state'), { recursive: true })
mkdirSync(diary, { recursive: true })
writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: 'bili-whale', dshGo: { title: { zh: 'B站养鱼' } } }), 'utf8')
writeFileSync(join(plugin, 'state', 'config.json'), JSON.stringify({ diaryPath: diary }), 'utf8')
writeFileSync(join(diary, '2026-11-08.md'), '今天很治愈。', 'utf8')
process.env.DSH_HOME = home

const { discoverWhale } = await import('../lib/discover.js')

test('能从插件配置里认出 bili-whale 和日记路径', () => {
  const r = discoverWhale({ fresh: true })
  assert.equal(r.found, true)
  assert.equal(r.pluginName, 'bili-whale')
  assert.equal(r.diaryPath, diary)
})

const { bootstrap } = await import('../lib/bootstrap.js')

test('bootstrap 把发现的日记路径写进自己的配置', () => {
  const r = bootstrap({ fresh: true })
  assert.equal(r.changed, true)
  assert.equal(r.cfg.diaryPath, diary)
  const file = join(home, 'dsh-go', 'plugins', 'dsh-emotionalwhale', 'state', 'config.json')
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(saved.diaryPath, diary)
})
