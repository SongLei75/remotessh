#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
BUILD="$ROOT/build"
PREFIX="$BUILD/install"
JOBS=${JOBS:-$(nproc)}

# AnyRouter installs an `ar` executable in ~/.npm-global/bin on this machine.
# Pin the real binutils tools so autotools/libtool cannot accidentally use it.
AR_BIN=${AR_BIN:-/usr/bin/ar}
RANLIB_BIN=${RANLIB_BIN:-/usr/bin/ranlib}

WOLFSSH_PATCH="$ROOT/patches/wolfssh-rfc6187-ecdsa-signature-name.patch"
PATCH_APPLIED_BY_BUILD=0
cleanup() {
    if [[ "$PATCH_APPLIED_BY_BUILD" == 1 ]]; then
        git -C "$ROOT/wolfssh" apply --unidiff-zero --reverse "$WOLFSSH_PATCH" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

if [[ -f "$WOLFSSH_PATCH" ]]; then
    if git -C "$ROOT/wolfssh" apply --unidiff-zero --reverse --check "$WOLFSSH_PATCH" >/dev/null 2>&1; then
        : # Patch already applied by the developer.
    elif git -C "$ROOT/wolfssh" apply --unidiff-zero --check "$WOLFSSH_PATCH" >/dev/null 2>&1; then
        git -C "$ROOT/wolfssh" apply --unidiff-zero "$WOLFSSH_PATCH"
        PATCH_APPLIED_BY_BUILD=1
    else
        echo "wolfSSH patch does not apply cleanly to the pinned submodule" >&2
        exit 1
    fi
fi

if [[ ! -x "$ROOT/wolfssl/configure" ]]; then
    (cd "$ROOT/wolfssl" && ./autogen.sh)
fi
if [[ ! -x "$ROOT/wolfssh/configure" ]]; then
    (cd "$ROOT/wolfssh" && ./autogen.sh)
fi

mkdir -p "$BUILD/wolfssl" "$BUILD/wolfssh"

(
    cd "$BUILD/wolfssl"
    "$ROOT/wolfssl/configure" \
        --prefix="$PREFIX" \
        --enable-shared --disable-static \
        --enable-wolfssh
    export MAKEFLAGS="-j$JOBS"
    make
    make install
)

(
    cd "$BUILD/wolfssh"
    AR="$AR_BIN" RANLIB="$RANLIB_BIN" \
    PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" \
    "$ROOT/wolfssh/configure" \
        --prefix="$PREFIX" \
        --with-wolfssl="$PREFIX" \
        --enable-shared --disable-static \
        --enable-certs --enable-scp
    export MAKEFLAGS="-j$JOBS"
    make
    make install
)

cmake -S "$ROOT" -B "$BUILD/wrapper" \
    -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    -DWOLF_PREFIX="$PREFIX"
cmake --build "$BUILD/wrapper" -j"$JOBS"

mkdir -p "$BUILD/bin" "$BUILD/lib"
rm -f "$BUILD/lib"/libboardssh.so "$BUILD/lib"/libwolfssh.so* "$BUILD/lib"/libwolfssl.so*
cp -f "$BUILD/wrapper/wolfssh" "$BUILD/bin/wolfssh"
cp -f "$BUILD/wrapper/wolfscp" "$BUILD/bin/wolfscp"
cp -af "$BUILD/wrapper/libboardssh.so" "$BUILD/lib/libboardssh.so"
cp -a "$PREFIX/lib"/libwolfssh.so* "$BUILD/lib/"
cp -a "$PREFIX/lib"/libwolfssl.so* "$BUILD/lib/"
