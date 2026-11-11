// dsh-fish 的数据目录：环境变量 → 迁移指针 → 默认 ~/.dsh-fish
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export function fishHome() {
  const env = String(process.env.DSH_FISH_HOME || '').trim()
  if (env && isAbsolute(env)) return env
  try {
    const root = String(JSON.parse(readFileSync(join(homedir(), '.dsh-fish-location.json'), 'utf8'))?.root || '').trim()
    if (root && isAbsolute(root)) return root
  } catch {}
  return join(homedir(), '.dsh-fish')
}
