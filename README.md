# 情感鲸鱼 · dsh-emotionalwhale

把「今天刷不刷视频」从一个写死的概率，改成一套**会被前一天后劲影响**的动态权重；再把结论写成文件，让市面上所有 B 站养鱼插件直接读。

**日记只读，插件不再自己记一份历史。** 哪些天刷过、连刷几天、隔了多久、最近刷到了什么后劲，全部从宿主写的日记/日报里推出来。

所有概率都是 0–1 的小数，1 = 100%。

> **0.0.7 修了什么**
> 1. **「记忆」胶囊去掉**：宿主 `composer.actions` 每个插件最多只认 2 个（`composer.actions allows 2 per plugin; the rest are ignored`），第 3 个会被直接忽略。现在只保留「今天刷吗 / 这阵子」，`记忆` 从面板入口（features / session.tab）进。
> 2. **空日记时不再报警**：一条记录都没有时，`day.gap` 的兜底值是 30，「断更 · 距上次 30 天」会被看成断了 30 天。现在显示「还没有记录」，`tone` 为 `muted`，`距上次` 指标显示 `—`。

> **0.0.6 新增了什么**
> 1. **第 4 个面板「记忆」**：回答「本鱼还记得什么，哪件事快想不起来了」。近 30 天记忆条、遗忘预警（「主人」/ BV 号 / 连更断更）、最近 5 条日记。
> 2. **修了一个线上事故**：以前没有 `mood` 的日记条目会被整条过滤掉，导致写了日记却没标情绪的那些天在面板里人间蒸发。现在 `mood` 为空也逐条显示（`写了，没标情绪` / `跳过日`）。
> 3. **依然是只读**：不写日记、不写日志、不重写 `gate.json`，不删、不衰减，也没有常驻定时器——打开面板时算一次。
> 4. `心情：感动`、`情绪：难过` 这种中文情绪写法现在也会被解析。

> **0.0.5 修了什么**
> 1. **手动「强制刷 / 强制不刷」现在对宿主真的生效**：强制时 gate 里的 `probability` / `noWatchProbability` 一起写成 1/0，不再只改 `watch` 字段。以前面板写着「今天你手动定了：不刷」，bili-whale 仍会按原概率自己掷一次（实测 75% 的概率照样去刷）。
> 2. gate 新增 `modelProbability`：强制前的模型原始概率，面板解释用；`probability` 是生效值，宿主读到的就是它。
> 3. `diceWeight` 的默认值注释从 0.3 更正为 0.2（实际默认一直是 0.2）。
> 4. 补了一条回归测试：强制时生效概率必须是 0/1，模型概率仍然保留。

> **改名说明（0.0.4）**：项目名改为 `dsh-emotionalwhale`，中文名保留「情感鲸鱼」。
> 插件目录、默认 state 路径、CLI 都换成新名字；上一代 `dsh-whale` 或更早 `local-whale-mood` 的 state，会在第一次运行时**复制**到新目录，之后只读写新目录，删旧文件夹不会丢配置。
> 为了不弄坏已经打过补丁的宿主，gate 协议名 `whale-mood/gate@1`、补丁 marker `MOOD-BRIDGE*` 保持不变；旧的 `*.whale-mood.bak` 也仍能还原。

升级后先让新插件跑一次（打开面板或跑 `--check`），确认 `~/.dsh/dsh-go/plugins/dsh-emotionalwhale/state/` 里已经有 `config.json` / `state.json` / `selfcheck.json`，再删旧插件文件夹。旧宿主的补丁备份在宿主自己的目录里，不在旧插件目录，删旧文件夹不会影响还原。

## 卸载：自动还原养鱼插件

在 dsh-go 里停用或删除本插件时，`dispose` 会自动把打过补丁的宿主还原回原文：

- 只还原仍带着 `MOOD-BRIDGE-*` 补丁的文件
- 如果宿主自己升级覆盖过补丁，就不拿旧备份盖新版本
- bili-whale 设置页里被改过的「今晚不看的概率（情感鲸鱼接管）」文案也会一起还原

手动还原（排查用）：

```sh
node bin/dsh-emotionalwhale.mjs --restore
```

备份文件是宿主文件旁边的 `*.emotionalwhale.bak`，还原成功后会删除。

## 两个方向别搞混

- 本插件的「想刷」= **今天刷视频的概率**
- 「不刷」= **今天不刷视频的概率**，两者相加永远是 1
- `gate.json` 里：`probability` 是想刷，`noWatchProbability` 是不刷
- bili-whale 的「今晚不看的概率」吃的是 **不刷**那一半；所以它显示 42% 时，本插件对应的是「想刷 58%」
- 面板和状态条现在同时写「想刷 xx% / 不刷 yy%」，不会再出现「不刷 48%」其实写的是想刷概率这种错位
- 命令行：`--watch` 打印想刷，`--no-watch` 打印不刷

## 安装：装完就能用

不需要新建对话，也不需要先手动填路径——插件第一次加载会自己把该做的事做完。

### 方式 A：有 shell（Termux / 电脑连手机）

```sh
unzip dsh-emotionalwhale-V0.0.5.zip
cd dsh-emotionalwhale
sh install.sh
```

脚本会自动做完这些：

1. 复制到 `$DSH_HOME/dsh-go/plugins/dsh-emotionalwhale`（已有 `state/` 保留）
2. 调 `dsh plugin --profile web add` 注册（找不到 dsh 命令就提示手动装）
3. 扫一遍插件目录，**自己认出所有 B 站养鱼宿主和它们的日记/日报位置**，写进本插件配置
4. 日记目录不存在就创建
5. **给所有认识的养鱼宿主打桥接补丁**：概率型改读 `gate.json`，配额/生态/看板型在自动刷的总闸门上看今天的结论
6. 先算一次今天，写出 `gate.json`，宿主马上能读
7. 跑一遍内置自检并打印结果

### 方式 B：只在 App 里装

把解压后的整个 `dsh-emotionalwhale` 文件夹放到：

```
~/.dsh/dsh-go/plugins/dsh-emotionalwhale
```

然后在 dsh-go 的插件页启用。App 内第一次加载会自动完成上面第 3～5 步。

### 装完之后

**完全退出 dsh-go 再打开一次**（不用新建对话）。正常情况下输入框上方就会出现：

- 状态条：`今天：不刷 58%`
- 胶囊：`今天刷吗`、`这阵子`

没出现就先看「插件页里是不是启用了」，再点面板里的「自检」。

### 这些事全自动，不用你管

| 事情 | 什么时候做 |
| --- | --- |
| 认宿主、认日记/日报位置 | 每次插件加载 |
| 建日记目录 / 写默认路径 | 第一次加载 |
| 打桥接补丁（所有认识的养鱼宿主） | 第一次加载；之后每 30 分钟检查一次，缺了就补 |
| 宿主升级把补丁覆盖 | 下一次检查自动重打，不用手动 `--bridge` |
| 刷新 `gate.json` | 加载时立刻算一次；之后每 30 分钟重算 |
| 自检并写 `selfcheck.json` | 每次加载 |
| 改坏了回滚 | 写文件后立刻 `node --check`，不过就还原 |

真正需要你动手的只有：安装、在插件页启用、想强制某天刷/不刷时点一下按钮。

### 它是怎么找到宿主的

插件启动时扫描：

- `$DSH_HOME/dsh-go/plugins/*` 和 `$DSH_HOME/plugins/*` 下每个插件的 `package.json`，按名字/标题/描述认出养鱼插件；
- 这些插件的 `state/config.json`、`config.json`、`settings.json` 里带 `diary` / `日记` 的路径；
- 插件目录里的 `diary/`、`diaries/`、`logs/`；
- 家目录的 `~/.dsh/whale-diary.md`、`~/.dsh/whale/diary`、`~/.dsh/bili-duty/out`、`~/.dsh-fish/diary`、`~/.dsh/fish-soul/soul.db`、`~/.dsh/diary` 等常见位置。
- `dsh-whale-panel` 的 `state.json`、`dsh-feed-scroll` 的 `state.json`、`dsh-fish` 的 `events.jsonl` 会被当成“观看账本”，只补「哪天刷过」，不补情绪。
- 日记文件里按 `## 2026-11-08` 分多天写也没关系，会一天一段分开算。

找到就写进自己的配置；找不到就用默认目录并创建，之后在「权重设置」里改，或重启 App 让它再找一次。**不需要把两个插件装在同一个文件夹里**——它们通过日记和 `gate.json` 对接。

### 桥接宿主（自动打，覆盖市面主流养鱼插件）

gate.json 是给宿主读的。能读的宿主直接读；读不到的地方，本插件在它**自动刷的总闸门**上加一道判断，不改它的业务逻辑。

| 插件 | 类型 | 补丁打在哪 | 今天「不刷」时 |
| --- | --- | --- | --- |
| bili-whale | 概率型 | `tools/lib/night-config.mjs` 的 `readNightConfig()` | `skipChance` 换成 gate 的 `noWatchProbability` |
| dsh-bili-scroll | 配额型 | `index.js` 自动 tick 开头 | 这一跳直接返回，不跑自动刷 |
| dsh-fish | 生态型 | `lib/scheduler.js` 的 `quietBrowse()` / `lookBeforeWake()` | 不刷站，但照常醒来、说话、写日记 |
| dsh-fish-soul | 人格型 | `lib/browse.js` 的 `BiliBrowser.run()` | 这一轮不刷，聊天/日程/日记照旧 |
| dsh-whale-panel | 看板型 | `index.js` 自动巡航 `setInterval` 里 | 自动巡航停一天，手动按钮不受影响 |
| dsh-feed-scroll | 多源刷帖型 | `index.js` 定时叫醒刷帖的循环里 | 只在刷 B站 / auto 混刷时停；知乎、掘金等源照常 |

识别不靠写死包名：同类插件的换名/换皮版本，只要结构还是上面这些入口，也会被认出来并接上。只读工具型 B 站插件（vision / watch / asr / 播放器 / radar 等）没有「今天刷不刷」的总闸门，不会被改，也不算失败。

共同规则：

- 只认**今天的** gate：不是今天、读不到、`watch` 不是 `false` → 一律照常，不拦
- **只拦自动刷**：手动点「让她去刷 / 立刻跑一轮」这类操作仍然有效（fish-soul 的刷站工具是自动/手动共用入口，手动也会被拦；要临时绕过设 `WHALE_MOOD_FORCE=1`）
- 第一次改之前备份为 `*.emotionalwhale.bak`；卸载/停用本插件时会自动还原
- 幂等：已有 `MOOD-BRIDGE-*` 标记就跳过
- 改完跑 `node --check`，语法不过自动还原
- **宿主升级覆盖后不用手动**：下一次加载或 30 分钟巡检会自动重打
- 面板和 `--bridge-status` 会列出每个宿主的类型、是否已接管

需要排查时再手动跑：

```sh
node ~/.dsh/dsh-go/plugins/dsh-emotionalwhale/bin/dsh-emotionalwhale.mjs --bridge
node ~/.dsh/dsh-go/plugins/dsh-emotionalwhale/bin/dsh-emotionalwhale.mjs --bridge-status
```

## 这一版砍掉了什么

| 上一版 | 现在 |
| --- | --- |
| 自己维护 `entries` 后劲记录 | 直接读日记，不再手记 |
| 「记后劲」面板 | 删掉，少一个面板和一套表单 |
| `decisions` 每日结论存档 | 由日记日期推出来，状态文件只剩「强制 + 重掷」 |
| `inbox.json` 宿主投喂 | 删掉，日记就是输入 |
| 几个小文件来回读写 | `config.json` + 一个很小的 `state.json` + `gate.json` |

## 时间怎么定

- **今天**用系统日期。日记没更新、插件半夜跑、跨天，都不会把日期卡在昨天。
- **历史和后劲**只认真正刷过的日期：标题/正文写着【不看】、没看、不刷、跳过，或 JSON 里 `watched:false` 的那天不算刷过；连刷、断更、半衰期都从真刷过的日子推。
- 日记只统计**今天以前**的日子；今天写的日记不会反过来影响今天已经做出的决定。
- 同一天有多份日记，取修改时间最新的那份。

这样既省掉了自己记历史，又不会被「日记晚写了一天」卡死。

## 日记从哪读

在「权重设置」面板里填**日记位置**（目录或单个文件）。留空会自动找：

```
~/.dsh/whale-diary.md
~/.dsh/whale/diary
~/.dsh/whale/diaries
~/.dsh/bili-duty/out
~/.dsh/fish/out
~/.dsh/dsh-go/diary
~/.dsh/diary
~/.dsh/dsh-go/plugins/bili-whale/diary
~/.dsh/dsh-go/plugins/dsh-emotionalwhale/diary
```

支持 `.md` `.markdown` `.txt` `.json` `.jsonl`。**路径会先自检**：不存在就创建，是文件就建文件、是目录就建目录；不可读/不可写/类型不对就退回默认位置，并在面板里写明状态（可用 / 已创建 / 已退回）。插件只保证位置能用，不往里写日记内容——日记由 dsh 每天刷完视频后写。

日期依次从：显式字段 → 文件名 `2026-11-08` → 正文前 400 字 → 文件修改时间。情绪优先认显式 `mood`，否则按关键词：

| 关键词 | 情绪 |
| --- | --- |
| 感动、泪目、眼眶一热、鼻子一酸、被打动、感慨、唏嘘 | moved |
| 治愈、温暖、暖心、被安慰、安心、踏实、释然 | healed |
| 上头、停不下来、一口气、刷到凌晨、入迷、追更 | hooked |
| 开心、好笑、笑死、愉快、雀跃、兴奋、满足、嘴角上扬 | happy |
| 生气、愤怒、气死、火大、恼火、离谱、无语 | angry |
| 后怕、害怕、吓到、恐怖、毛骨悚然、细思极恐 | scared |
| emo、难过、伤感、想哭、破防、失落、空虚、低落、沮丧、压抑、难受、心疼、遗憾、孤独、郁闷、丧 | sad |
| 平淡、无聊、没意思、麻木、一般般 | flat |

情绪字段里写中文（`mood: 难过`）或英文（`mood: sad`）都会先归一化到同一类，不会一个算 sad、一个算 flat。也认 `心情：感动`、`情绪：难过` 这种写法。

强度认 `强度：80` 或 JSON 里的 `intensity`（0–1 或 0–100），没有就按 0.6。

**不能按「有日记 = 刷过」算。** bili-whale 在「今天不看」的日子也会醒来写一段解释，所以文案里出现【不看】/没看/不刷/跳过时，那天只记为「跳过」，不进连刷，也不拿它的情绪当后劲。没有日记的日期同样算没刷；哪天刷了却忘了写，连刷会断一天，这是这套算法的前提。

JSON 日记可以直接写 `"watched": false`（或 `"skip": true`）来明确标记跳过。

如果跳过那天写着「还在伤心 / 后劲没缓过来 / 缓不过来」，它会当成**被后劲拖住**：

- 不算「憋久了想刷」的回弹天数（`gapDays` 照实显示，`returnGap` 会把这几天减掉）
- 它的情绪以半权重继续衰减，不会把同一段后劲重复算满
- 普通休息、没时间而不看的日子，仍然正常计入回弹

建议日记至少带这几个字段（JSON 最省事）：

```json
{ "date": "2026-11-08", "mood": "sad", "intensity": 0.8, "note": "看完那个纪录片" }
```

Markdown 也可以：

```md
---
date: 2026-11-08
mood: sad
intensity: 80
---
今天刷到一个很伤感的视频，看哭了。
```

## 概率怎么来的

`想刷概率 = 基础意愿 + 后劲 + 连刷的腻 + 断更回弹 + 周末 + 每日浮动`，最后夹在上下限内。

### 为什么「想刷 57%」最后却可能不刷？

57% 是**今天想刷的倾向**，不是「过半就一定刷」。为了不让骰子压过倾向，判定用一条加权判定线：

```text
判定线 = 多数派 + (想刷概率 − 多数派) × 骰子权重
roll < 判定线 → 刷
roll ≥ 判定线 → 不刷
```

- `骰子权重 = 1`：完全按概率掷骰，57% 就是 57% 的刷面
- `骰子权重 = 0`：完全按多数，57% 就一定刷
- 默认 `0.2`：概率主导 80%，骰子只做小幅扰动

所以想刷 57% 时，多数派是 1，判定线 = `1 + (0.57 − 1) × 0.2 = 0.914`，也就是 **91.4% 的骰子面会刷**，只有 8.6% 会不刷。判定线会写进 `gate.json` 的 `watchChance`，面板摘要也会写成「骰子 xx% ≥ 判定线 87%」，不再拿 57% 当骰子阈值。

「重掷今天」只换骰子，不会重新读日记或重算后劲；概率会因每日浮动小幅变化，连续几次都落在不刷仍有可能。重掷后的 toast 会直接写这次的结果，例如「想刷 57%，骰子 68% ≥ 判定线 91.4%，这次没中，所以不刷」。

| 因子 | 默认 | 说明 |
| --- | --- | --- |
| 基础意愿 `base` | 0.58 | 平时的默认意愿 |
| 后劲 `wAfterglow` | 0.45 | 日记里的情绪经 tanh 压缩后最多给到 ±0.45 |
| 连刷的腻 `wFatigue` | 0.2 | 日记显示连刷 4 天就扣满 −0.2 |
| 断更回弹 `wReturn` | 0.15 | 距上次 7 天就加满 +0.15 |
| 周末 `wWeekend` | 0.06 | 周六日加一点 |
| 每日浮动 `wJitter` | 0.1 | 用日期做种子，同一天固定 |
| 骰子权重 `diceWeight` | 0.2 | 1=完全掷骰，0=完全按多数；默认让概率主导 80% |
| 半衰期 `halfLifeHours` | 18h | 后劲每 18 小时减半 |
| 压缩尺度 `moodScale` | 2 | 后劲分数到 2 时约发挥 76% |
| 上下限 `floor` / `ceiling` | 0.08 / 0.96 | 保留「万一」 |

后劲没有硬封顶：分数继续累加，影响量用 `tanh(分数 / 2)` 平滑压到 ±0.45 以内。

情绪映射（强度 0–1）：

| 情绪 | 值 | 情绪 | 值 |
| --- | --- | --- | --- |
| 伤感 | −2.0 | 治愈 | +1.4 |
| emo | −1.8 | 感动 | +1.2 |
| 生气 | −1.5 | 开心 | +1.0 |
| 后怕 | −1.0 | 上头 | +1.8 |
| 平淡 | −0.4 | | |

举例：日记写昨晚伤感、强度 0.8，隔 12 小时分数 ≈ −1.8×0.8×2^(−12/18) ≈ −0.9；tanh 压缩后约 −0.19。0.58 + 0.15（断更）− 0.19 − 0.04 ≈ **0.50**。

## 界面

- **状态条**：`今天：不刷 58%`
- **胶囊**：`今天刷吗`、`这阵子`（宿主每个插件最多 2 个胶囊；`记忆` 从面板入口进）
- **面板**：`今天刷不刷`（概率、结论、后劲、影响因素、14 天曲线、重掷/强制/自检；强制后概率直接显示 100% / 0%，因为那是宿主实际会读到的值）、`权重设置`（日记路径 + 11 个滑杆 + 最近日记 + 路径状态）、`这阵子`（柱状图 + 最近 8 天表）、`记忆`（近 30 天记忆条、遗忘预警、最近 5 条，mood 为空也逐条显示）

## 记忆面板

第 4 个面板回答另一个问题：**本鱼还记得什么，哪件事快想不起来了。**

- **只读**：不写日记、不写日志、不重写 `gate.json`；不删、不衰减；没有常驻定时器，打开面板时算一次。
- **近 30 天记忆条**：每天「有没有写日记」，不看有没有情绪；另一组是「有情绪的天数」（情绪靠正文关键词，可能漏）。
- **遗忘预警**（纯文本匹配）：`「主人」上次出现：N 天前`、最久没被提起的 3 个 `BV` 号、`连更 N 天 · 距上次 M 天`。
- **最近 5 条逐条显示**，情绪为空也保留：`mood` 有值写 `感动 · 72%`，`mood` 为空写 `写了，没标情绪`，明确不刷的那天写 `跳过日`。
- **空状态**：没找到日记 / 文件在但没解析出日期段 / 有条目但全没情绪，三种情况都有文案，不会白屏。

## 文件

| 文件 | 用途 |
| --- | --- |
| `state/config.json` | 权重、日记位置 |
| `state/state.json` | 只剩今天的强制和重掷次数 |
| `~/.dsh/whale/gate.json` | **给宿主插件读的今日结论** |

`gate.json`：

```json
{
  "schema": "whale-mood/gate@1",
  "date": "2026-11-09",
  "probability": 0.422,
  "modelProbability": 0.422,
  "noWatchProbability": 0.578,
  "watch": false,
  "roll": 0.661,
  "forced": false,
  "streak": 1,
  "gapDays": 1,
  "topMood": "sad",
  "diary": {
    "found": true,
    "path": "/home/user/.dsh/whale/diary",
    "ok": true,
    "created": false,
    "fallback": false,
    "latestDate": "2026-11-08",
    "latestMood": "sad"
  },
  "summary": "后劲还没散，今天大概率不想刷。"
}
```

## 接宿主

```js
import { noWatchProbability } from '.../dsh-emotionalwhale/lib/adapter.js'
const p = noWatchProbability(1) // 读不到 gate 就退回原来的 1；返回值 0–1
```

或者：

```sh
node ~/.dsh/dsh-go/plugins/dsh-emotionalwhale/bin/dsh-emotionalwhale.mjs --no-watch
```

完整说明见 [`integration/host-adapter.md`](./integration/host-adapter.md)。

## 命令行

```sh
emotionalwhale --gate            # 完整 gate
emotionalwhale --no-watch        # 不刷概率 0–1
emotionalwhale --watch           # 想刷概率 0–1
emotionalwhale --decide          # watch / skip
emotionalwhale --diary           # 读到的日记摘要（含路径自检）
emotionalwhale --path /某/目录    # 只自检/创建路径
emotionalwhale --discover        # 找 bili-whale 和它的日记
emotionalwhale --bootstrap       # 自动发现并写好配置
emotionalwhale --check           # 内置自检（失败退出码 1）
emotionalwhale --bridge          # 给所有认识的宿主打桥接补丁
emotionalwhale --bridge-status   # 只看桥接状态
emotionalwhale --force skip      # watch / skip / auto
emotionalwhale --reroll
```

## 自检

### 1. 安装时自动跑

`sh install.sh` 最后一步会打印一张表，13 项全过就是 `自检通过：13/13`。

### 2. 命令行随时跑

```sh
node ~/.dsh/dsh-go/plugins/dsh-emotionalwhale/bin/dsh-emotionalwhale.mjs --check
```

- 通过：退出码 `0`，最后一行 `自检通过：13/13`
- 有失败：退出码 `1`，并列出哪一项挂了
- 报告落在 `~/.dsh/dsh-go/plugins/dsh-emotionalwhale/state/selfcheck.json`

只想看它找到了什么：

```sh
node ~/.dsh/dsh-go/plugins/dsh-emotionalwhale/bin/dsh-emotionalwhale.mjs --discover
node ~/.dsh/dsh-go/plugins/dsh-emotionalwhale/bin/dsh-emotionalwhale.mjs --bootstrap
node ~/.dsh/dsh-go/plugins/dsh-emotionalwhale/bin/dsh-emotionalwhale.mjs --diary
```

### 3. 面板里点「自检」

`今天刷不刷` 面板底部有个「自检」按钮，点一下跑同一套检查，toast 显示结果；上方会显示上次自检的时间。

### 自检查什么

| # | 项目 | 失败会怎样 |
| --- | --- | --- |
| 1 | 清单文件 | dsh-go 不会加载 |
| 2 | 原生面板 | 界面缺块 |
| 3 | 程序文件 | 缺模块，功能不全 |
| 4 | 概率范围 | 算出的数不在 0–1 |
| 5 | 日记位置 | 路径不可用、创建失败 |
| 6 | 发现养鱼宿主 | 只是提醒，会先用默认目录 |
| 7 | 观看账本 | whale-panel / feed-scroll / fish 的观看记录读不到 |
| 8 | SQLite 日记 | fish-soul 的 soul.db 打不开或没有 diary 行 |
| 9 | 生活日记 | dsh-fish 的日记目录读不到 |
| 10 | 宿主桥接 | 找到宿主但补丁没打上（会列出是哪几个） |
| 11 | 卸载还原 | 补丁旁边没有 `.emotionalwhale.bak`，卸载时无法还原 |
| 12 | 结论文件 | gate.json 写不出来 |
| 13 | 宿主读取 | 宿主读到的不是 0–1 |

第 6、7、8、9、10、11 项在没装对应宿主时只是 `warn`，不算失败：插件本身仍然能用，日记路径会先用默认目录并自动创建。

### 开发时自查

```sh
node --test test/*.test.mjs
DSH_HOME=/tmp/dshhome node <kit>/bin/check.mjs . --load --lang zh
```

## 边界

- 日记只读，插件不写日记、不碰 B 站、不自动评论。
- gate 过期 36 小时后宿主应退回自己的默认值。
- 概率是 0–1 的「想刷」概率；宿主要「不刷」就取 `noWatchProbability`。
- 手动强制会同时定死 `probability` / `noWatchProbability`（1/0），所以宿主不用再掷一次；`modelProbability` 保留模型原始概率。
- 状态是全局一份（一只鲸鱼一份），不按会话分。
- 如果日记格式特殊，把路径填进「权重设置」，或给一条样例再收紧解析。
