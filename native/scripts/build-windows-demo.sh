#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
JS="$ROOT/js"
DEMO="$JS/demo/windows-cli"
BUILD="$ROOT/build"
NODE_VERSION=${NODE_VERSION:-$(node -p 'process.versions.node')}
NODE_ZIP="$BUILD/node-v${NODE_VERSION}-win-x64.zip"
NODE_TMP="$BUILD/node-win-${NODE_VERSION}"

cleanup() {
    rm -rf "$NODE_TMP" "$NODE_ZIP"
}
trap cleanup EXIT

cd "$JS"
npm run build -w @songlei/board-session
npm run build -w board-windows-demo

cd "$DEMO"
node --experimental-sea-config sea-config.json

mkdir -p "$BUILD"
curl -L --fail --retry 3 \
    -o "$NODE_ZIP" \
    "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip"
rm -rf "$NODE_TMP"
mkdir -p "$NODE_TMP"
unzip -q "$NODE_ZIP" -d "$NODE_TMP"
cp "$NODE_TMP/node-v${NODE_VERSION}-win-x64/node.exe" "$DEMO/dist/board-demo.exe"

cd "$JS"
npx postject \
    "$DEMO/dist/board-demo.exe" \
    NODE_SEA_BLOB "$DEMO/dist/board-demo.blob" \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

file "$DEMO/dist/board-demo.exe"
ls -lh "$DEMO/dist/board-demo.exe"
