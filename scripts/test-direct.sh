#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WOLF=$(cd "$ROOT/../wolf" && pwd)
LOCAL_PORT=${DIRECT_PORT:-22021}
LOG="/tmp/remotessh-iap-direct.$$.log"
cleanup() {
    if [[ -n "${IAP_PID:-}" ]]; then
        kill "$IAP_PID" 2>/dev/null || true
        wait "$IAP_PID" 2>/dev/null || true
    fi
    rm -f "$LOG"
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
sleep 2
LD_LIBRARY_PATH="$WOLF/out/release/linux/lib" \
    "$WOLF/out/release/linux/bin/wolfssh" -X \
    -i "$HOME/.ssh/client-identity.pem" -l songlei -p "$LOCAL_PORT" \
    127.0.0.1 "${*:-hostname}"
