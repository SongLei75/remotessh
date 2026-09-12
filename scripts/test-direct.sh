#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WOLF=$(cd "$ROOT/../wolf" && pwd)
LOCAL_PORT=${DIRECT_PORT:-22021}
HOME_DIR="$ROOT/.runtime/direct-home"
LOG="$ROOT/.runtime/iap-direct.log"
mkdir -p "$HOME_DIR/.ssh" "$ROOT/.runtime"
awk '{$1="127.0.0.1"; print}' "$ROOT/config/gcpp/known_hosts" > "$HOME_DIR/.ssh/known_hosts"
chmod 600 "$HOME_DIR/.ssh/known_hosts"
cleanup() {
    if [[ -n "${IAP_PID:-}" ]]; then
        kill "$IAP_PID" 2>/dev/null || true
        wait "$IAP_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT
/snap/bin/gcloud compute start-iap-tunnel gcp-free-dev 2222 \
    --local-host-port="127.0.0.1:${LOCAL_PORT}" \
    --project=gen-lang-client-0429627202 --zone=us-west1-b --verbosity=warning \
    >"$LOG" 2>&1 &
IAP_PID=$!
ready=0
for _ in $(seq 1 60); do
    if ss -ltnH "sport = :$LOCAL_PORT" | grep -q .; then
        ready=1
        break
    fi
    kill -0 "$IAP_PID" 2>/dev/null || { cat "$LOG"; exit 1; }
    sleep 0.25
done
[[ "$ready" == 1 ]] || { cat "$LOG"; exit 1; }
# gcloud opens the local listener slightly before the IAP WebSocket backend
# is ready to carry SSH bytes.
sleep 2
HOME="$HOME_DIR" LD_LIBRARY_PATH="$WOLF/out/release/linux/lib" \
    "$WOLF/out/release/linux/bin/wolfssh" -X \
    -i "$ROOT/config/gcpp/client-identity.pem" -l songlei -p "$LOCAL_PORT" \
    127.0.0.1 "${*:-hostname}"
