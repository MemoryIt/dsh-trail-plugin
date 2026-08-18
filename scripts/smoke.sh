#!/usr/bin/env bash
# Smoke test: boot a DSH profile with dsh-trail-plugin mounted and assert the
# hello-world line appears in the startup log. 证明「DSH 启动时正确加载了当前插件」。
#
# 必选服务（cordis fiber inject）：dsh-trail-plugin 声明
# sessionProjections / sessionProjectionCache 为硬依赖——fiber 等待齐备才激活
# apply，缺席则 boot 失败 loud（pending: waiting for service）。trail-test profile
# 经 dsh-base 已有 sessionProjections（dsh-session-projection）与
# sessionPersistence（session-persistence-jsonl），但 sessionProjectionCache
# （dsh-session-projection-cache）只在 web-app bundle 里，且它自身还依赖
# storage 栈（storage / storage-json / storage-domain）——因此本脚本把
# web-app bundle 里这四行原样装进测试 profile，与正式 web profile 一致。
#
# 环境变量：
#   DSH_BIN    dsh CLI 调用方式（默认 dsh；本机示例：'node /app/apps/cli/lib/bin.js'）
#   DSH_HOME   DSH 数据目录（默认 ~/.dsh）
#   PROFILE    测试用的 profile 名（默认 trail-test，与正式 GUI 的 web profile 隔离）
#
# 用法：
#   DSH_BIN='node /app/apps/cli/lib/bin.js' ./scripts/smoke.sh

set -euo pipefail

read -r -a DSH_CMD <<< "${DSH_BIN:-dsh}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${PROFILE:-trail-test}"
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PATCH="$DSH_HOME/profiles/$PROFILE/cordis.patch.yml"
HELLO_RE='hello world from dsh-trail-plugin (host)'

echo "==> build plugin"
(cd "$PLUGIN_DIR" && pnpm build)

echo "==> install plugin + console logger + projection-cache 及其 storage 依赖 into profile '$PROFILE'"
"${DSH_CMD[@]}" plugin --profile "$PROFILE" add "$PLUGIN_DIR"
"${DSH_CMD[@]}" plugin --profile "$PROFILE" add @deepseek-ai/cordis-plugin-logger-console
"${DSH_CMD[@]}" plugin --profile "$PROFILE" add @deepseek-ai/dsh-storage
"${DSH_CMD[@]}" plugin --profile "$PROFILE" add @deepseek-ai/dsh-storage-json
"${DSH_CMD[@]}" plugin --profile "$PROFILE" add @deepseek-ai/dsh-storage-domain
"${DSH_CMD[@]}" plugin --profile "$PROFILE" add @deepseek-ai/dsh-session-projection-cache

echo "==> write mount patch to $PATCH"
cat > "$PATCH" <<EOF
# dsh-trail-plugin 挂载验证（由 scripts/smoke.sh 生成）
- insert:
    # 必选服务：sessionProjectionCache 及其 storage 栈（dsh-base 只带 session-projection）。
    # 配置与 @deepseek-ai/dsh-web-app bundle 一致。
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
    - id: dsh-trail-plugin
      name: '@deepseek-ai/dsh-trail-plugin'
      config:
        enabled: true
        label: dsh-trail
EOF

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
