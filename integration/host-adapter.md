# 让宿主插件读「情感鲸鱼」

宿主 = bili-whale、dsh-bili-scroll、dsh-fish、dsh-fish-soul、dsh-whale-panel、dsh-feed-scroll，或者任何自己决定「今天刷不刷」的插件。
原则只有一条：**不要再用写死的概率，改成每天读一次 `gate.json`，读不到再退回原来的值。**

所有概率都是 0–1 的小数，1 = 100%，和宿主里 `1` 的算法一致。

这一版是单向的：

```
bili-whale 写日记  →  情感鲸鱼 读日记算概率  →  gate.json  →  宿主直接读
```

插件不写日记。安装时会自动给认识的宿主打最小桥接：只接在它自动刷的总闸门上，让它读 gate；改前备份，可还原。安装脚本和插件第一次加载还会自动扫描插件目录，认出 bili-whale / dsh-emotionalwhale 和它的日记位置，不需要手动填；找不到才用默认目录。

### 桥接补丁（多宿主）

| 宿主 | 补丁点 | 语义 |
| --- | --- | --- |
| bili-whale | `readNightConfig()` | 用 gate 的 `noWatchProbability` 替换 `skipChance` |
| dsh-bili-scroll | 自动 tick 开头 | `watch === false` 时这一跳不跑 |
| dsh-fish | `quietBrowse()` / `lookBeforeWake()` | `watch === false` 时不刷站，醒来和日记照旧 |
| dsh-fish-soul | `BiliBrowser.run()` | `watch === false` 时这一轮不刷，聊天/日程照旧 |
| dsh-whale-panel | 自动巡航 `setInterval` | `watch === false` 时巡航停一拍，手动不受影响 |
| dsh-feed-scroll | 定时叫醒刷帖的循环 | 刷 B站 / auto 混刷时 `watch === false` 就跳过；其它源不受影响 |

- 标记：`MOOD-BRIDGE` / `MOOD-BRIDGE-SCROLL` / `MOOD-BRIDGE-FISH` / `MOOD-BRIDGE-FISH-SOUL` / `MOOD-BRIDGE-PANEL` / `MOOD-BRIDGE-FEED`
- 备份：`*.emotionalwhale.bak`；宿主升级后下一次加载或 30 分钟巡检会自动重打，不需要手动跑
- 只认今天的 gate，读不到或过期一律照常
- 只拦自动刷，手动操作仍然有效

## 二、宿主是 Python / 别的语言

```python
import json, os, time

def no_watch_probability(fallback=1.0, max_age_h=36):
    path = os.path.join(os.path.expanduser("~/.dsh/whale"), "gate.json")
    try:
        with open(path, encoding="utf-8") as f:
            gate = json.load(f)
        age_h = (time.time() - gate["updatedAtMs"] / 1000) / 3600
        if age_h > max_age_h:
            return fallback
        return min(1.0, max(0.0, gate["noWatchProbability"]))
    except Exception:
        return fallback
```

只认一个数字的话，用命令行：

```python
import os, subprocess
p = float(subprocess.check_output([
    "node", os.path.expanduser("~/.dsh/dsh-go/plugins/dsh-emotionalwhale/bin/dsh-emotionalwhale.mjs"),
    "--no-watch",
], text=True).strip())
```

## 三、宿主只读文件（任何语言）

每天读 `~/.dsh/whale/gate.json`：

| 字段 | 类型 | 用法 |
| --- | --- | --- |
| `probability` | 0–1 | 想刷概率 |
| `noWatchProbability` | 0–1 | **不刷概率（替换写死的那一栏）** |
| `watch` | bool | 今天到底刷不刷 |
| `forced` / `override` | bool / `watch`\|`skip`\|`null` | 用户是否手动定了今天 |
| `date` | `YYYY-MM-DD` | 判断是不是今天的结论 |
| `updatedAtMs` | 毫秒时间戳 | 过期判断，建议 36 小时 |
| `diary` | 对象 | 日记路径自检结果（`ok` `created` `fallback`）和最新日期/情绪 |
| `summary` / `factors` | 文案 / 数组 | 想显示「为什么」时用 |

读取顺序：

1. 文件不存在 → 用宿主原来的默认值；
2. `date` 不是今天，或 `updatedAtMs` 超过 36 小时 → 用默认值；
3. 否则直接用 `noWatchProbability`（已经是 0–1）。

## 四、日记怎么给插件读

日记由 dsh 每天刷完视频后写，插件只读、不写内容。默认找这几个位置：

```
~/.dsh/whale/diary
~/.dsh/whale/diaries
~/.dsh/dsh-go/diary
~/.dsh/diary
~/.dsh/dsh-go/plugins/bili-whale/diary
~/.dsh/dsh-go/plugins/dsh-emotionalwhale/diary
```

不在这些位置，就在「权重设置」里把**日记位置**填成目录或单个文件。支持 `.md` `.txt` `.json` `.jsonl`。

**路径会先自检**：不存在就创建；不可读、不可写、类型不对就退回默认位置，状态写进 gate 的 `diary.ok` / `diary.created` / `diary.fallback`，面板上也能看到。

最省事的格式（JSON）：

```json
{ "date": "2026-11-08", "mood": "sad", "intensity": 0.8, "note": "看完那个纪录片" }
```

或多天的数组 / JSONL。Markdown 用 frontmatter：

```md
---
date: 2026-11-08
mood: sad
intensity: 80
---
今天刷到一个很伤感的视频，看哭了。
```

没有 `mood` 时按关键词识别（伤感、感动、治愈、上头、生气、后怕…）；强度没写就按 0.6。

## 五、对接后自查

```sh
# 看读到的日记和路径自检结果
node ~/.dsh/dsh-go/plugins/dsh-emotionalwhale/bin/dsh-emotionalwhale.mjs --diary

# 只自检并创建路径
node ~/.dsh/dsh-go/plugins/dsh-emotionalwhale/bin/dsh-emotionalwhale.mjs --path ~/.dsh/whale/diary

# 看自动发现结果 / 跑内置自检
node ~/.dsh/dsh-go/plugins/dsh-emotionalwhale/bin/dsh-emotionalwhale.mjs --discover
node ~/.dsh/dsh-go/plugins/dsh-emotionalwhale/bin/dsh-emotionalwhale.mjs --check

# 看今天的结论（概率 0–1）
node ~/.dsh/dsh-go/plugins/dsh-emotionalwhale/bin/dsh-emotionalwhale.mjs --gate

# 宿主侧只需要这个数字
node ~/.dsh/dsh-go/plugins/dsh-emotionalwhale/bin/dsh-emotionalwhale.mjs --no-watch
```
