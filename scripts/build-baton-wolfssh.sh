#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WOLF=$(cd "$ROOT/../wolf" && pwd)
BUILD="$ROOT/build/baton-wolfssh"
SRC="$BUILD/src"
OUT="$BUILD/wolfssh"
WOLFSSL="$WOLF/out/build/linux/stage/wolfssl"

if [[ ! -d "$WOLFSSL/include" || ! -d "$WOLFSSL/lib" ]]; then
    echo "missing company wolfSSL build under $WOLFSSL; build ../wolf first" >&2
    exit 1
fi

rm -rf "$BUILD"
mkdir -p "$SRC"
rsync -a "$WOLF/wolfssh/" "$SRC/"
cd "$SRC"
./autogen.sh

export PATH=/usr/bin:/bin:/usr/local/bin
export CFLAGS='-Wno-error=discarded-qualifiers -Wno-error=stringop-truncation'
export CPPFLAGS="-DTEST_IPV6 -I$WOLFSSL/include"
export LDFLAGS="-L$WOLFSSL/lib"

./configure \
    --with-wolfssl="$WOLFSSL" \
    --enable-certs \
    --enable-sshclient \
    --enable-scp \
    --enable-sftp \
    --enable-fwd
make -j2 apps/wolfssh/wolfssh
cp apps/wolfssh/.libs/wolfssh "$OUT"
echo "$OUT"
