#!/usr/bin/env bash
set -euo pipefail

CMD=${*:-hostname}

# `gcpp` is a real Baton workflow:
# local OpenSSH -> OCI E1 -> RemoteCommand starts company wolfssh on E1 -> GCP.
printf '%s\nexit\n' "$CMD" | ssh -o BatchMode=yes -o ConnectTimeout=15 gcpp
