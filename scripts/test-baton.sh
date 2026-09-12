#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WOLF=$(cd "$ROOT/../wolf" && pwd)
LOCAL_PORT=${BATON_PORT:-22022}
HOME_DIR="$ROOT/.runtime/baton-home"
LOG="$ROOT/.runtime/baton-ssh.log"
mkdir -p "$HOME_DIR/.ssh" "$ROOT/.runtime"
awk '{$1="127.0.0.1"; print}' "$ROOT/config/gcpp/known_hosts" > "$HOME_DIR/.ssh/known_hosts"
chmod 600 "$HOME_DIR/.ssh/known_hosts"
cleanup() {
    if [[ -n "${SSH_PID:-}" ]]; then
        kill "$SSH_PID" 2>/dev/null || true
        wait "$SSH_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT
ssh -o BatchMode=yes -o ConnectTimeout=15 gcpp >"$LOG" 2>&1 &
SSH_PID=$!
for _ in $(seq 1 60); do
    ss -ltnH "sport = :$LOCAL_PORT" | grep -q . && break
    kill -0 "$SSH_PID" 2>/dev/null || { cat "$LOG"; exit 1; }
    sleep 0.25
done
HOME="$HOME_DIR" LD_LIBRARY_PATH="$WOLF/out/release/linux/lib" \
    "$WOLF/out/release/linux/bin/wolfssh" -X \
    -i "$ROOT/config/gcpp/client-identity.pem" -l songlei -p "$LOCAL_PORT" \
    127.0.0.1 "${*:-hostname}"
