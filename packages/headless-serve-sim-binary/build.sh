#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building headless-serve-sim-bin (universal: arm64 + x86_64)..."

export DEVELOPER_DIR=$(xcode-select -p)

swift build \
    -c release \
    --arch arm64 \
    --arch x86_64 \
    --build-path .build

mkdir -p bin
# Ask SwiftPM where the universal product landed — the layout moved between
# toolchains (Xcode 26/27: .build/out/Products/Release, older: .build/apple/...),
# and copying a hardcoded stale path silently ships an old binary.
BIN_DIR="$(swift build -c release --arch arm64 --arch x86_64 --build-path .build --show-bin-path)"
cp "$BIN_DIR/headless-serve-sim-bin" bin/headless-serve-sim-bin

# Re-sign after copy (required for framework linking)
codesign -s - -f bin/headless-serve-sim-bin 2>/dev/null

echo "Built: bin/headless-serve-sim-bin"
file bin/headless-serve-sim-bin
lipo -info bin/headless-serve-sim-bin || true
