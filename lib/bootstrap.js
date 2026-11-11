// 第一次运行就把能自动做的事做掉：
//   1. 自己找 bili-whale / dsh-emotionalwhale 的插件目录
//   2. 从它的配置/目录里认出日记位置
//   3. 把 diaryPath 写进本插件配置（只写一次，用户后来改过就不动）
//   4. 自检并创建日记位置
//
// 目标是「装上就能用」：不用新建对话、不用手动填路径。

import { readConfig, writeConfig } from './store.js'
import { discoverWhale } from './discover.js'
import { resolveDiaryTarget } from './diaryPath.js'
import { applyAllBridges } from './bridge.js'

let bridgeTried = false

export function bootstrap({ save = true, fresh = false } = {}) {
  const cfg = readConfig()
  const found = discoverWhale({ fresh })
  let changed = false

  if (!cfg.diaryPath && found.diaryPath) {
    cfg.diaryPath = found.diaryPath
    changed = true
  }

  if (changed && save) {
    try {
      writeConfig(cfg)
    } catch {}
  }

  const target = resolveDiaryTarget(cfg)

  // 第一次加载顺手把所有宿主的桥接打上（幂等；失败不影响本插件）
  let bridges = []
  if (!bridgeTried) {
    bridgeTried = true
    try {
      bridges = applyAllBridges()
    } catch {}
  }

  return { cfg, found, target, changed, bridges }
}

/** 面板/CLI 共用的「今天」计算入口：先 bootstrap，再算 gate。 */
export function autoConfig() {
  if (autoConfig.done) return autoConfig.done
  const result = bootstrap()
  // 没找到日记也不算失败：默认目录会被 resolveDiaryTarget 建出来
  autoConfig.done = result
  return result
}
