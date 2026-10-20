#!/usr/bin/env bash
# Ensure a headless-serve-sim stream helper is running for a simulator, and
# print its JSON ({url, streamUrl, wsUrl, port, device}).
# Usage: ensure-running.sh <UDID or device name>
#
# Always pass a device. With a device, an existing helper is reused, and
# otherwise one is started with `headless-serve-sim --detach`, which boots the
# simulator if needed. Without a device, the script can print nothing: the
# CLI refuses to start a stream for an unspecified device.
# Equivalent one-liner: headless-serve-sim --detach -q "<UDID>" (also idempotent).

set -u

DEVICE="${1:-}"

# Reuse a helper that is already running
EXISTING="$(headless-serve-sim --list -q 2>/dev/null || echo '[]')"
if [[ "$EXISTING" != "[]" && -n "$EXISTING" ]]; then
  if [[ -n "$DEVICE" ]]; then
    MATCH="$(echo "$EXISTING" | node -e "
      const arr = JSON.parse(require('fs').readFileSync(0, 'utf8'));
      const d = process.argv[1].toLowerCase();
      const m = arr.find(x => (x.device || '').toLowerCase().includes(d) || x.udid === d);
      if (m) console.log(JSON.stringify(m));
    " "$DEVICE")"
    if [[ -n "$MATCH" ]]; then
      echo "$MATCH"
      exit 0
    fi
  else
    # No specific device requested — return the first running one
    echo "$EXISTING" | node -e "
      const arr = JSON.parse(require('fs').readFileSync(0, 'utf8'));
      if (arr[0]) console.log(JSON.stringify(arr[0]));
    "
    exit 0
  fi
fi

# Start (or reuse) a detached helper; --detach is idempotent per device
if [[ -n "$DEVICE" ]]; then
  headless-serve-sim --detach -q "$DEVICE"
else
  headless-serve-sim --detach -q
fi
