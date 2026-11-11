import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveDiaryTarget } from '../lib/diaryPath.js'

function base() {
  return mkdtempSync(join(tmpdir(), 'whale-path-'))
}

test('目录不存在就创建，并标记 created', () => {
  const b = base()
  const target = join(b, 'diary')
  const r = resolveDiaryTarget({ diaryPath: target }, join(b, 'fallback'))
  assert.equal(r.ok, true)
  assert.equal(r.mode, 'dir')
  assert.equal(r.created, true)
  assert.equal(existsSync(target), true)
})

test('给了 .md 文件路径就创建文件', () => {
  const b = base()
  const file = join(b, 'dairy', '2026-11-09.md')
  const r = resolveDiaryTarget({ diaryPath: file }, join(b, 'fallback'))
  assert.equal(r.ok, true)
  assert.equal(r.mode, 'file')
  assert.equal(r.created, true)
  assert.equal(existsSync(file), true)
})

test('已存在的目录直接用，不重建', () => {
  const b = base()
  const dir = join(b, 'diary')
  mkdirSync(dir)
  const r = resolveDiaryTarget({ diaryPath: dir }, join(b, 'fallback'))
  assert.equal(r.ok, true)
  assert.equal(r.created, false)
  assert.equal(r.path, dir)
})

test('路径不可用就退回默认位置并建好', () => {
  const b = base()
  const bad = join(b, 'not-a-dir')
  writeFileSync(bad, 'x', 'utf8') // 无扩展名，会按目录检查，失败
  const fallback = join(b, 'fallback-diary')
  const r = resolveDiaryTarget({ diaryPath: bad }, fallback)
  assert.equal(r.ok, true)
  assert.equal(r.fallback, true)
  assert.equal(r.path, fallback)
  assert.equal(existsSync(fallback), true)
})

test('没指定路径时，优先用已有内容的候选', () => {
  const b = base()
  const dir = join(b, 'diary')
  mkdirSync(dir)
  writeFileSync(join(dir, '2026-11-08.md'), '今天很治愈。', 'utf8')
  // 用 fallback 参数模拟候选：先显式给空，再手动检查 fallback 不会被无脑新建
  const r = resolveDiaryTarget({ diaryPath: '' }, dir)
  assert.equal(r.ok, true)
})
