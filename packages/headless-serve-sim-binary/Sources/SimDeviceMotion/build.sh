#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${1:-$HERE/../../dist/simmotion}"
mkdir -p "$OUT_DIR"

SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
BIN="$OUT_DIR/headless-serve-sim-device-motion"

xcrun --sdk iphonesimulator clang \
    -arch arm64 -arch x86_64 \
    -mios-simulator-version-min=15.0 \
    -isysroot "$SDK" \
    -fobjc-arc \
    -framework Foundation \
    -framework IOKit \
    -o "$BIN" \
    "$HERE/sim-device-motion.m"

printf 'Built: %s\n' "$BIN"
file "$BIN"

OBSERVER_BIN="$OUT_DIR/headless-serve-sim-display-observer"
xcrun --sdk iphonesimulator clang \
    -arch arm64 -arch x86_64 \
    -mios-simulator-version-min=15.0 \
    -isysroot "$SDK" \
    -fobjc-arc \
    -framework Foundation \
    -framework IOKit \
    -o "$OBSERVER_BIN" \
    "$HERE/sim-display-observer.m"

printf 'Built: %s\n' "$OBSERVER_BIN"
file "$OBSERVER_BIN"
