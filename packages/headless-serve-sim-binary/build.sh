#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# arm64 only: Xcode 26+ requires Apple Silicon, and Xcode 27 ships SimulatorKit
# and CoreSimulator as arm64e-only — an x86_64 slice links neither framework and
# would start up then find no simulator classes at all.
echo "Building headless-serve-sim-bin (arm64)..."

export DEVELOPER_DIR=$(xcode-select -p)

swift build \
    -c release \
    --arch arm64 \
    --build-path .build

mkdir -p bin
# Ask SwiftPM where the product landed — the layout moved between toolchains
# (Xcode 26/27: .build/out/Products/Release, older: .build/apple/...), and
# copying a hardcoded stale path silently ships an old binary.
BIN_DIR="$(swift build -c release --arch arm64 --build-path .build --show-bin-path)"
cp "$BIN_DIR/headless-serve-sim-bin" bin/headless-serve-sim-bin

# Re-sign after copy so the kernel will exec the relocated binary.
codesign -s - -f bin/headless-serve-sim-bin 2>/dev/null

echo "Built: bin/headless-serve-sim-bin"
file bin/headless-serve-sim-bin
lipo -info bin/headless-serve-sim-bin || true
