#!/usr/bin/env bash
# Smoke test: boot a DSH profile with dsh-trail-plugin mounted and assert the
# hello-world line appears in the startup log. 证明「DSH 启动时正确加载了当前插件」。
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

echo "==> install plugin + console logger into profile '$PROFILE'"
"${DSH_CMD[@]}" plugin --profile "$PROFILE" add "$PLUGIN_DIR"
"${DSH_CMD[@]}" plugin --profile "$PROFILE" add @deepseek-ai/cordis-plugin-logger-console

echo "==> write mount patch to $PATCH"
cat > "$PATCH" <<EOF
# dsh-trail-plugin 挂载验证（由 scripts/smoke.sh 生成）
- insert:
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
