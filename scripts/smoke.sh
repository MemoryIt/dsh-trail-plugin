#!/usr/bin/env bash
# Smoke test: boot a DSH profile with dsh-trail-plugin mounted and assert the
# hello-world line appears in the startup log. 证明「DSH 启动时正确加载了当前插件」。
#
# 插件以 bundle 形态安装：`dsh plugin add` 后（package.json 声明
# `dsh.bundle.patch`）自动进 profile 的 dsh.profile.bundles，boot 时由 bundle 层
# 把组合行插进树，无需手工写 profile 的 cordis.patch.yml。
#
# 必选服务（cordis fiber inject）：dsh-trail-plugin 声明
# sessionProjections / sessionProjectionCache 为硬依赖——fiber 等待齐备才激活
# apply，缺席则 boot 失败 loud（pending: waiting for service）。trail-test profile
# 经 dsh-base 已有 sessionProjections（dsh-session-projection）与
# sessionPersistence（session-persistence-jsonl），但 sessionProjectionCache
# （dsh-session-projection-cache）只在 web-app bundle 里，且它自身还依赖
# storage 栈（storage / storage-json / storage-domain）——因此本脚本把
# web-app bundle 里这四行原样装进测试 profile 的用户层，与正式 web profile 一致。
# 注意：这四行不能进本插件的 bundle patch——web profile 的 web-app bundle 已提供
# 同 id 行，bundle 里再 insert 会 duplicate loader entry id。
#
# 环境变量：
#   DSH_BIN    dsh CLI 调用方式（默认 'pnpm --dir /app dsh'——容器内源码方式运行）
#   DSH_HOME   DSH 数据目录（默认 ~/.dsh）
#   PROFILE    测试用的 profile 名（默认 trail-test，与正式 GUI 的 web profile 隔离）
#
# 用法：
#   ./scripts/smoke.sh

set -euo pipefail

read -r -a DSH_CMD <<< "${DSH_BIN:-pnpm --dir /app dsh}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${PROFILE:-trail-test}"
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PATCH="$DSH_HOME/profiles/$PROFILE/cordis.patch.yml"
HELLO_RE='hello world from dsh-trail-plugin (host)'

echo "==> build plugin"
(cd "$PLUGIN_DIR" && pnpm build)

# 旧包名依赖（bundle 改名前的 @deepseek-ai/dsh-trail-plugin）会与新包名同时声明
# dsh.bundle、双双进 bundles 层 → 同 id 重复插入。删掉旧键，失败（本就没有）可忽略。
echo "==> drop stale package-name dependency (if any)"
"${DSH_CMD[@]}" plugin --profile "$PROFILE" remove @deepseek-ai/dsh-trail-plugin 2>/dev/null || true

echo "==> install plugin + console logger + projection-cache 及其 storage 依赖 into profile '$PROFILE'"
"${DSH_CMD[@]}" plugin --profile "$PROFILE" add "$PLUGIN_DIR"
"${DSH_CMD[@]}" plugin --profile "$PROFILE" add @deepseek-ai/cordis-plugin-logger-console
"${DSH_CMD[@]}" plugin --profile "$PROFILE" add @deepseek-ai/dsh-storage
"${DSH_CMD[@]}" plugin --profile "$PROFILE" add @deepseek-ai/dsh-storage-json
"${DSH_CMD[@]}" plugin --profile "$PROFILE" add @deepseek-ai/dsh-storage-domain
"${DSH_CMD[@]}" plugin --profile "$PROFILE" add @deepseek-ai/dsh-session-projection-cache

echo "==> write storage-stack patch to $PATCH (bundle 层已负责 dsh-trail-plugin 行)"
cat > "$PATCH" <<EOF
# dsh-trail-plugin 挂载验证（由 scripts/smoke.sh 生成）。
# dsh-trail-plugin 行由 bundle 层（cordis.patch.yml）自动插入，勿在此重复。
# 这里只补 bundle 层不提供的 storage 栈 + console logger（web profile 由
# web-app bundle 提供，trail-test 只有 dsh-base）。
- insert:
    - id: storage
      name: '@deepseek-ai/dsh-storage'
    - id: storage-json
      name: '@deepseek-ai/dsh-storage-json'
      config:
        root: !!js dshHomePath('storages')
    - id: storage-domain
      name: '@deepseek-ai/dsh-storage-domain'
      config:
        backend: json
    - id: session-projection-cache
      name: '@deepseek-ai/dsh-session-projection-cache'
      config:
        writeEveryEvents: 200
        writeIntervalMs: 5000
    - id: logger-console
      name: '@deepseek-ai/cordis-plugin-logger-console'
EOF

echo "==> verify bundle layer composes exactly one dsh-trail-plugin row"
DUMP="$(mktemp)"
"${DSH_CMD[@]}" --profile "$PROFILE" --dump-config > "$DUMP" 2>&1 || true
if [ "$(grep -c 'id: dsh-trail-plugin' "$DUMP")" -eq 1 ]; then
  echo "OK: dump-config shows the bundle-inserted row:"
  grep -B1 -A4 'id: dsh-trail-plugin' "$DUMP"
  rm -f "$DUMP"
else
  echo "FAIL: expected exactly one 'id: dsh-trail-plugin' row in dump-config: $DUMP"
  tail -30 "$DUMP"
  exit 1
fi

LOG="$(mktemp)"
echo "==> boot profile '$PROFILE' (15s window)"
set +e
timeout 15 "${DSH_CMD[@]}" --profile "$PROFILE" > "$LOG" 2>&1
set -e

if grep -q "$HELLO_RE" "$LOG"; then
  echo "OK: hello world observed in DSH startup log:"
  grep "$HELLO_RE" "$LOG"
  rm -f "$LOG"
else
  echo "FAIL: hello world not found in boot log: $LOG"
  tail -20 "$LOG"
  exit 1
fi
