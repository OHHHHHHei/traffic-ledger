#!/bin/bash

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LEDGER_URL="http://127.0.0.1:8766"

ready() {
    curl --noproxy '*' -fsS --max-time 2 "$LEDGER_URL/" >/dev/null 2>&1
}

finish() {
    echo
    read -r -p "按回车键关闭窗口..." || true
}

fail() {
    printf '%s\n' "$@" >&2
    finish
    exit 1
}

wait_until_ready() {
    for attempt in {1..20}; do
        ready && return 0
        sleep 0.5
    done
    return 1
}

echo "Traffic Ledger · 流量账本"
echo

if ! ready; then
    echo "正在启动后台记录服务..."
    LEDGER_PYTHON="$PROJECT_DIR/.venv/bin/python"
    [ -x "$LEDGER_PYTHON" ] || LEDGER_PYTHON=python3
    "$LEDGER_PYTHON" "$PROJECT_DIR/scripts/manage.py" start || fail "未能启动后台记录服务。"
    wait_until_ready || fail "账本未能打开，请查看日志：" "$HOME/Library/Application Support/LocalTrafficLedger/error.log"
fi

open "$LEDGER_URL" || fail "未能打开浏览器。可以手动访问：$LEDGER_URL"
echo "已打开：$LEDGER_URL"
echo "关闭网页或本窗口后，后台仍会继续记录流量。"
finish
