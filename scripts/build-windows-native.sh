#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BUILD="$ROOT/build"
OUT="$BUILD/windows-x64"
PREFIX="$OUT/install"
TC="$BUILD/.toolchain-windows"
TARGET=x86_64-w64-mingw32
LLVM_MINGW_VERSION=${LLVM_MINGW_VERSION:-20260826}
LLVM_MINGW_ARCHIVE="$BUILD/llvm-mingw-${LLVM_MINGW_VERSION}.tar.xz"
LLVM_MINGW_URL="https://github.com/mstorsjo/llvm-mingw/releases/download/${LLVM_MINGW_VERSION}/llvm-mingw-${LLVM_MINGW_VERSION}-ucrt-ubuntu-22.04-x86_64.tar.xz"
DOWNLOADED_TOOLCHAIN=0
WOLFSSH_WT="$OUT/wolfssh-src"
WOLFSSL_WT="$OUT/wolfssl-src"

cleanup() {
    git -C "$ROOT/wolfssh" worktree remove --force "$WOLFSSH_WT" >/dev/null 2>&1 || true
    git -C "$ROOT/wolfssl" worktree remove --force "$WOLFSSL_WT" >/dev/null 2>&1 || true
    rm -f "$LLVM_MINGW_ARCHIVE"
    if [[ "$DOWNLOADED_TOOLCHAIN" == 1 && "${KEEP_TOOLCHAIN:-0}" != 1 ]]; then
        rm -rf "$TC"
    fi
}
trap cleanup EXIT

mkdir -p "$BUILD"
if [[ ! -x "$TC/bin/${TARGET}-clang" ]]; then
    rm -rf "$TC" "$LLVM_MINGW_ARCHIVE"
    curl -L --fail --retry 3 -o "$LLVM_MINGW_ARCHIVE" "$LLVM_MINGW_URL"
    mkdir -p "$TC"
    tar -xJf "$LLVM_MINGW_ARCHIVE" -C "$TC" --strip-components=1
    DOWNLOADED_TOOLCHAIN=1
fi

rm -rf "$OUT"
mkdir -p "$OUT"
git -C "$ROOT/wolfssh" worktree add --detach "$WOLFSSH_WT" "$(git -C "$ROOT/wolfssh" rev-parse HEAD)"
git -C "$ROOT/wolfssl" worktree add --detach "$WOLFSSL_WT" "$(git -C "$ROOT/wolfssl" rev-parse HEAD)"
git -C "$WOLFSSH_WT" apply --unidiff-zero "$ROOT/patches/wolfssh-rfc6187-ecdsa-signature-name.patch"

if [[ ! -x "$WOLFSSL_WT/configure" ]]; then
    (cd "$WOLFSSL_WT" && ./autogen.sh)
fi
if [[ ! -x "$WOLFSSH_WT/configure" ]]; then
    (cd "$WOLFSSH_WT" && ./autogen.sh)
fi

export PATH="$TC/bin:$PATH"
export CC="${TARGET}-clang"
export AR="${TARGET}-ar"
export RANLIB="${TARGET}-ranlib"
export STRIP="${TARGET}-strip"
export CFLAGS='-O2 -D_WIN32_WINNT=0x0A00'

mkdir -p "$OUT/wolfssl-build" "$OUT/wolfssh-build" "$PREFIX"
(
    cd "$OUT/wolfssl-build"
    "$WOLFSSL_WT/configure" \
        --host="$TARGET" \
        --prefix="$PREFIX" \
        --enable-static --disable-shared \
        --enable-wolfssh \
        --disable-examples --disable-crypttests
    make -j"$(nproc)"
    make install
)

(
    cd "$OUT/wolfssh-build"
    PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" \
    "$WOLFSSH_WT/configure" \
        --host="$TARGET" \
        --prefix="$PREFIX" \
        --with-wolfssl="$PREFIX" \
        --enable-static --disable-shared \
        --enable-certs --enable-scp --disable-examples
    make -j"$(nproc)"
    make install
)

cmake -S "$ROOT" -B "$OUT/wrapper" \
    -DCMAKE_SYSTEM_NAME=Windows \
    -DCMAKE_SYSTEM_PROCESSOR=x86_64 \
    -DCMAKE_C_COMPILER="$TC/bin/${TARGET}-clang" \
    -DCMAKE_AR="$TC/bin/${TARGET}-ar" \
    -DCMAKE_RANLIB="$TC/bin/${TARGET}-ranlib" \
    -DCMAKE_C_FLAGS='-O2 -D_WIN32_WINNT=0x0A00' \
    -DCMAKE_EXE_LINKER_FLAGS='-static' \
    -DWOLF_PREFIX="$PREFIX" \
    -DCMAKE_BUILD_TYPE=Release
cmake --build "$OUT/wrapper" -j"$(nproc)"

mkdir -p "$ROOT/js/packages/board-session/native/win32-x64"
cp -f "$OUT/wrapper/wolfssh.exe" \
    "$ROOT/js/packages/board-session/native/win32-x64/wolfssh.exe"

file "$ROOT/js/packages/board-session/native/win32-x64/wolfssh.exe"
ls -lh "$ROOT/js/packages/board-session/native/win32-x64/wolfssh.exe"
