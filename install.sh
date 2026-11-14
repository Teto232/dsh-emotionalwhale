#!/usr/bin/env sh
# 「情感鲸鱼 / dsh-emotionalwhale」一键安装：
#   1. 复制到 $DSH_HOME/dsh-go/plugins/dsh-emotionalwhale（保留已有 state/）
#   2. 自动注册到 dsh 的 web profile
#   3. 自己找 bili-whale / dsh-emotionalwhale，认出日记位置并写进配置
#   4. 建好日记目录，先算一次今天的不刷概率（宿主马上能读 gate.json）
#   5. 跑内置自检并打印结果
#
# 用法：
#   sh install.sh              安装 + 注册 + 自检
#   sh install.sh --no-register 只复制和初始化，不动 dsh 配置
#   sh install.sh --check-only  只跑自检（已经装过时用）

set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DSH_HOME=${DSH_HOME:-$HOME/.dsh}
DEST="${DSH_HOME:-$HOME/.dsh}/dsh-go/plugins/dsh-emotionalwhale"

MODE=install
for arg in "$@"; do
  case "$arg" in
    --no-register) MODE=noreg ;;
    --check-only) MODE=check ;;
    --help|-h)
      echo "用法：sh install.sh [--no-register|--check-only]"
      exit 0
      ;;
  esac
done

find_bin() {
  name=$1
  for c in "$(command -v "$name" 2>/dev/null || true)" \
           "$DSH_HOME/bin/$name" \
           "${PREFIX:-/usr}/bin/$name" \
           "$HOME/bin/$name" \
           "$HOME/.local/bin/$name" \
           "/data/data/com.termux/files/usr/bin/$name"; do
    if [ -n "$c" ] && [ -x "$c" ]; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

NODE_BIN=$(find_bin node || true)

if [ "$MODE" != "check" ]; then
  echo "→ 安装到：$DEST"
  mkdir -p "$DEST"
  # 只同步代码和文档，state/ 原样保留（换版本不丢设置）
  for item in package.json cordis.patch.yml lib bin test integration README.md install.sh; do
    if [ -e "$HERE/$item" ]; then
      rm -rf "$DEST/$item"
      cp -R "$HERE/$item" "$DEST/$item"
    fi
  done

  if [ "$MODE" = "install" ]; then
    DSH_BIN=$(find_bin dsh || true)
    if [ -n "${DSH_BIN:-}" ]; then
      echo "→ 注册插件（profile: web）"
      if ! "$DSH_BIN" plugin --profile web add "$DEST"; then
        echo "  web profile 没注册上，再试默认 profile"
        "$DSH_BIN" plugin add "$DEST" || echo "  注册失败：可在 App 的插件页手动添加 $DEST"
      fi
    else
      echo "→ 没找到 dsh 命令（正常，如果是在电脑上解压的）"
      echo "  App 里安装时：把整个 dsh-emotionalwhale 文件夹放到"
      echo "  $DSH_HOME/dsh-go/plugins/ 下面，然后在插件页启用即可。"
    fi
  fi
fi

if [ -z "${NODE_BIN:-}" ]; then
  echo "→ 没找到 node，跳过初始化和自检（App 内首次加载会自动做）"
  exit 0
fi

echo "→ 自动发现 bili-whale / 日记位置"
"$NODE_BIN" "$DEST/bin/dsh-emotionalwhale.mjs" --bootstrap || true

echo "→ 给认识的宿主打桥接（让它读 gate.json）"
"$NODE_BIN" "$DEST/bin/dsh-emotionalwhale.mjs" --bridge || true

echo "→ 建日记目录并先算一次今天"
"$NODE_BIN" "$DEST/bin/dsh-emotionalwhale.mjs" --gate >/dev/null || true

echo "→ 内置自检"
set +e
"$NODE_BIN" "$DEST/bin/dsh-emotionalwhale.mjs" --check >/tmp/emotionalwhale-selfcheck.json 2>/tmp/emotionalwhale-selfcheck.txt
CODE=$?
set -e
cat /tmp/emotionalwhale-selfcheck.txt 2>/dev/null || true

echo
if [ "$CODE" -eq 0 ]; then
  echo "装好了。"
else
  echo "装好了，但自检有失败项，详见：$DEST/state/selfcheck.json"
fi
echo "接下来：完全退出 dsh-go 再打开（不用新建对话）。"
echo "输入框上方会出现「今天刷不刷」，胶囊是「今天刷吗 / 这阵子」。"
echo "给宿主读的结论：${WHALE_GATE_DIR:-$DSH_HOME/whale}/gate.json"
echo "自检随时可跑：node $DEST/bin/dsh-emotionalwhale.mjs --check"
exit "$CODE"
