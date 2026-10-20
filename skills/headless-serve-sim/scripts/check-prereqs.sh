#!/usr/bin/env bash
# Verify the host satisfies headless-serve-sim's prerequisites.
# Exits 0 if everything is OK, 1 with a human-readable message otherwise.
# Run it once per session, before the first headless-serve-sim command.
# Missing optional pieces (macOS 14 for camera, a booted simulator) only warn.

set -u

fail() {
  echo "headless-serve-sim prereq check failed: $1" >&2
  exit 1
}

# Apple Silicon macOS host
if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "headless-serve-sim requires macOS. Detected: $(uname -s)."
fi

if ! /usr/bin/arch -arm64 /usr/bin/true 2>/dev/null; then
  fail "headless-serve-sim release builds require an Apple Silicon Mac (arm64)."
fi

# Xcode (simctl). headless-serve-sim also loads SimulatorKit from the active
# Xcode, so the full app (26 or newer) is needed, not just the command line tools.
if ! command -v xcrun >/dev/null 2>&1; then
  fail "xcrun not found. Install Xcode 26 or newer from the App Store or developer.apple.com, then run: sudo xcode-select -s /Applications/Xcode.app"
fi
if ! xcrun --find simctl >/dev/null 2>&1; then
  fail "simctl not found via xcrun. Install full Xcode 26 or newer (not just the command line tools) and select it: sudo xcode-select -s /Applications/Xcode.app"
fi

# Node 18+ (used only by this skill's helper scripts; the CLI itself is a
# self-contained binary)
if ! command -v node >/dev/null 2>&1; then
  fail "node not found. This skill's helper scripts need Node.js 18 or newer (e.g. mise use -g node@lts). The headless-serve-sim CLI itself does not."
fi
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  fail "node $NODE_MAJOR detected. This skill's helper scripts need Node.js 18+ (e.g. mise use -g node@lts)."
fi

# The headless-serve-sim CLI (GitHub release, installed via mise; not on npm)
if ! command -v headless-serve-sim >/dev/null 2>&1; then
  fail "headless-serve-sim not found on PATH. Install it with mise: mise use -g github:vvisionnn/headless-serve-sim (or download headless-serve-sim-darwin-arm64.tar.gz from https://github.com/vvisionnn/headless-serve-sim/releases/latest)."
fi

# macOS 14+ is optional (camera-only), so warn rather than fail
MACOS_MAJOR="$(sw_vers -productVersion | cut -d. -f1)"
if [[ "$MACOS_MAJOR" -lt 14 ]]; then
  echo "warning: macOS $(sw_vers -productVersion) detected. The 'camera' subcommand requires macOS 14+." >&2
fi

# No simulator needs to be booted up front: headless-serve-sim boots one itself.
if ! xcrun simctl list devices booted 2>/dev/null | grep -q "Booted"; then
  echo "note: no booted simulator yet. headless-serve-sim boots one on demand: headless-serve-sim --detach \"<UDID or name>\"" >&2
fi

echo "headless-serve-sim prereqs OK."
exit 0
