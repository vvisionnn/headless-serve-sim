#!/usr/bin/env bash
# Verify the host satisfies headless-serve-sim's prerequisites.
# Exits 0 if everything is OK, 1 with a human message otherwise.
# Intended to be sourced by an agent before any other headless-serve-sim command.

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
  fail "The released headless-serve-sim CLI requires an Apple Silicon Mac (arm64)."
fi

# Xcode CLI tools (simctl)
if ! command -v xcrun >/dev/null 2>&1; then
  fail "xcrun not found. Install Xcode command line tools: xcode-select --install"
fi
if ! xcrun --find simctl >/dev/null 2>&1; then
  fail "simctl not found via xcrun. Install Xcode command line tools."
fi

# Node 18+
if ! command -v node >/dev/null 2>&1; then
  fail "node not found. Install Node.js 18 or newer (https://nodejs.org)."
fi
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  fail "node $NODE_MAJOR detected. The headless-serve-sim skill requires Node.js 18+."
fi

# Released CLI
if ! command -v headless-serve-sim >/dev/null 2>&1; then
  fail "headless-serve-sim not found. Download the latest GitHub release and add it to PATH."
fi

# macOS 14+ is optional (camera-only), so warn rather than fail
MACOS_MAJOR="$(sw_vers -productVersion | cut -d. -f1)"
if [[ "$MACOS_MAJOR" -lt 14 ]]; then
  echo "warning: macOS $(sw_vers -productVersion) detected. The 'camera' subcommand requires macOS 14+." >&2
fi

# A booted simulator is required for most commands
if ! xcrun simctl list devices booted 2>/dev/null | grep -q "Booted"; then
  echo "warning: no booted simulator detected. Boot one with Xcode > Simulator or 'xcrun simctl boot <UDID>'." >&2
fi

echo "headless-serve-sim prereqs OK."
exit 0
