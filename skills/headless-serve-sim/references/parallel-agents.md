# Multiple simulators and parallel agents

headless-serve-sim runs one helper per simulator, so several devices can stream and take input at once. Examples include an iPhone and an iPad side by side, the Watch alongside its phone, or several agents (one per git worktree or branch) each testing on its own device.

## Contents

- Rules that keep parallel runs safe
- Give each agent its own simulator
- Ports
- Starting, discovering and stopping
- Looking at several devices at once

## Rules that keep parallel runs safe

1. **One simulator per agent.** Two agents tapping the same device corrupt each other's runs.
2. **Use the UDID everywhere:**
   - every headless-serve-sim call takes `-d "$UDID"`;
   - every `xcrun simctl` call takes `"$UDID"`, never `booted`;
   - the preview takes the device as an argument.
3. **Discover; don't assume.** Read your helper's URL from `$TMPDIR/headless-serve-sim/server-$UDID.json`, or from `headless-serve-sim --list "$UDID"`. Do not glob the state directory and do not hard-code ports.
4. **Clean up only what you own.** Run `headless-serve-sim --kill "$UDID"`. **Never** run a bare `headless-serve-sim --kill`, because it stops every helper on the machine.
5. **Shut your simulator down at the end** if you booted it: `xcrun simctl shutdown "$UDID"`. headless-serve-sim never shuts a simulator down on its own.

## Give each agent its own simulator

Name simulators after the worktree or task so they are easy to find, and so a crashed run can be cleaned up later:

```sh
NAME="ci-$(basename "$PWD")"
UDID=$(xcrun simctl list devices -j | jq -r --arg n "$NAME" \
  '[.devices[][] | select(.name == $n and .isAvailable)][0].udid // empty')
if [ -z "$UDID" ]; then
  UDID=$(xcrun simctl create "$NAME" "iPhone 17 Pro")   # optionally add a runtime id
fi
echo "$UDID"
```

`xcrun simctl clone <source-UDID> "$NAME"` copies a prepared device, with its apps and settings, which is faster than reinstalling everything.

Device names are matched exactly and case-insensitively across every installed simulator. Two simulators can share a name on different runtimes, which is another reason to pass the UDID.

## Ports

| Process | Default | How it is chosen |
|---|---|---|
| Helper | 3100 | The first free port from the start port, skipping ports claimed in other state files. `--detach -p <port>` sets the start port. |
| Preview | 3200 | `-p <port>` binds exactly that port and fails if it is busy. Without `-p`, the preview scans up to 50 ports upward. |

A preview started with a device argument always starts that device's helper search at 3100, because `-p` only moves the preview. When agents start simultaneously, give each one a distinct block, for example `offset = worktree index`:

```sh
headless-serve-sim --detach -p $((3100 + OFFSET * 10)) -q "$UDID"   # helper
headless-serve-sim -p $((3200 + OFFSET * 10)) "$UDID" &              # optional preview
```

Starting helpers with `--detach` before starting any preview avoids two processes racing for the same port.

## Starting, discovering and stopping

```sh
# Start (boots the device if needed; idempotent if already running)
headless-serve-sim --detach -q "$UDID"
HELPER=$(jq -r .url "$TMPDIR/headless-serve-sim/server-$UDID.json")
curl -sf "$HELPER/health" >/dev/null && echo ready

# Drive
headless-serve-sim tap 0.5 0.5 -d "$UDID"
headless-serve-sim screenshot "/tmp/$UDID.png" -d "$UDID"

# Stop
headless-serve-sim --kill "$UDID"
xcrun simctl shutdown "$UDID"
```

One command can start several helpers. It prints `{devices:[{url, streamUrl, wsUrl, port, device}, …]}`:

```sh
headless-serve-sim --detach -q "$IPHONE_UDID" "$IPAD_UDID"
```

## Looking at several devices at once

For humans, a single preview server covers every simulator on the Mac:

- the **Navigator** lists every simulator, with Boot & stream and Shut down actions;
- the **Wall** shows every running simulator side by side, sized by device family so a watch reads as a watch next to a phone;
- **⌘K** switches between them.

Start it without a device (`headless-serve-sim`) to get the picker, or with one device to focus that device.

For agents, take a screenshot per device (`headless-serve-sim screenshot … -d "$UDID"`) and compare the images.
