#!/usr/bin/env bash
set -euo pipefail

# Non-interactive health check for the real Baton path:
# local OpenSSH -> OCI E1 -> company wolfssh on E1 -> GCP PKIX-SSHD.
ssh -T -o BatchMode=yes -o ConnectTimeout=15 \
  -o 'RemoteCommand=env HOME=/home/ubuntu/.local/remotessh/home LD_LIBRARY_PATH=/home/ubuntu/.local/remotessh/company-wolf/lib /home/ubuntu/.local/remotessh/company-wolf/bin/wolfssh -X -i /home/ubuntu/.local/remotessh/config/client-identity.pem -l songlei -p 2222 2600:1900:4041:46c:0:2:0:0 hostname' \
  gcpp
