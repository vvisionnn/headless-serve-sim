# Workflows reference

End-to-end recipes built from the primitives in the other reference files. Each one assumes `$UDID` is set to your simulator's UDID. List simulators with `xcrun simctl list devices`, or create one as shown in [parallel-agents.md](parallel-agents.md).

## Contents

- 0. Start a session
- 1. Tap an element by accessibility label
- 2. Deep-link into an app and verify the screen
- 3. Test a camera capture flow
- 4. Find rendering problems (blended layers)
- 5. Clean slate between runs
- 6. Screenshot set for review (status bar, appearance, text size)
- 7. Show the simulator to a human

## 0. Start a session

```sh
scripts/check-prereqs.sh                          # once per session
headless-serve-sim --detach -q "$UDID"            # boots the device if needed; prints helper JSON
xcrun simctl bootstatus "$UDID" -b >/dev/null     # wait until fully booted
HELPER=$(jq -r .url "$TMPDIR/headless-serve-sim/server-$UDID.json")
curl -sf "$HELPER/health"                         # {"status":"ok"}
```

To install and launch your app:

```sh
xcrun simctl install "$UDID" path/to/MyApp.app
xcrun simctl launch "$UDID" com.acme.MyApp
```

Before driving the app, confirm it is in the foreground:

```sh
for i in $(seq 1 40); do
  [ "$(curl -s "$HELPER/foreground" | jq -r .bundleId)" = "com.acme.MyApp" ] && break
  sleep 0.25
done
```

## 1. Tap an element by accessibility label

Pixel-hunting breaks across device sizes, so drive taps from the accessibility tree. `/ax` frames are in **points**, so normalize them by the root frame, not by `/config` pixels.

```sh
AX=$(curl -s "$HELPER/ax")

# Root frame = the whole screen, in points
SW=$(echo "$AX" | jq '.[0].frame.width')
SH=$(echo "$AX" | jq '.[0].frame.height')

# First enabled element whose label is "Submit" (searches the whole tree)
TARGET=$(echo "$AX" | jq -c '[.. | objects | select(.AXLabel? == "Submit" and (.enabled // true))][0] // empty')

# Guard: never guess coordinates when the element is missing
if [ -z "$TARGET" ]; then
  echo "ERROR: no element labelled 'Submit' on screen" >&2
  exit 2
fi

NX=$(echo "$TARGET" | jq --argjson w "$SW" '(.frame.x + .frame.width / 2) / $w')
NY=$(echo "$TARGET" | jq --argjson h "$SH" '(.frame.y + .frame.height / 2) / $h')
headless-serve-sim tap "$NX" "$NY" -d "$UDID"
```

- To match on an identifier, select on `.AXUniqueId == "submit-button"`. Identifiers are more stable than labels across localizations.
- After tapping, re-read `/ax` or take a screenshot to confirm the result. Do not assume the tap worked.
- If the tree is empty or `/ax` returns 503, the app may still be launching. Wait and retry.

## 2. Deep-link into an app and verify the screen

```sh
headless-serve-sim app-actions open-url "myapp://products/42" -d "$UDID"
sleep 1

curl -s "$HELPER/foreground" | jq            # expect {"bundleId":"com.acme.MyApp", ...}
curl -s "$HELPER/ax" | jq '[.. | objects | select((.AXLabel? // "") | test("Product 42"))] | length'
headless-serve-sim screenshot /tmp/product-42.png -d "$UDID"
```

## 3. Test a camera capture flow

```sh
headless-serve-sim camera --stop-webcam -d "$UDID"
xcrun simctl terminate "$UDID" com.acme.MyApp 2>/dev/null
headless-serve-sim permissions grant camera com.acme.MyApp -d "$UDID"

# Inject a known image (no mirroring, so text in it reads correctly); this launches the app
headless-serve-sim camera com.acme.MyApp --file ~/test-assets/reference.png --mirror off -d "$UDID"

headless-serve-sim app-actions open-url "myapp://camera/capture" -d "$UDID"
sleep 1
headless-serve-sim tap 0.5 0.9 -d "$UDID"      # shutter; prefer an AX lookup (workflow 1)
sleep 1

APP_DATA=$(xcrun simctl get_app_container "$UDID" com.acme.MyApp data)
ls -la "$APP_DATA/Documents/"

headless-serve-sim camera --stop-webcam -d "$UDID"
```

See [camera.md](camera.md) for the other sources (looping video, a host webcam) and for hot-swapping.

## 4. Find rendering problems (blended layers)

```sh
headless-serve-sim ca-debug blended on -d "$UDID"
headless-serve-sim app-actions open-url "myapp://settings" -d "$UDID"
sleep 1
headless-serve-sim screenshot /tmp/blended.png -d "$UDID"
headless-serve-sim ca-debug blended off -d "$UDID"
```

Red regions are blended layers, which cost the GPU extra work; green regions are opaque. Read the screenshot and report which views are red. For the other overlays, see [ca-debug.md](ca-debug.md).

## 5. Clean slate between runs

```sh
xcrun simctl terminate "$UDID" com.acme.MyApp 2>/dev/null
headless-serve-sim permissions reset all com.acme.MyApp -d "$UDID"
headless-serve-sim defaults delete com.acme.MyApp hasOnboarded -d "$UDID"   # app-specific keys
headless-serve-sim app-actions keychain-reset -d "$UDID"
xcrun simctl launch "$UDID" com.acme.MyApp
```

For a full reset, which **destroys every app and all data** on that simulator, run the following only when the user asks for it:

```sh
headless-serve-sim --kill "$UDID"
xcrun simctl shutdown "$UDID"
xcrun simctl erase "$UDID"
headless-serve-sim --detach -q "$UDID"
```

## 6. Screenshot set for review (status bar, appearance, text size)

```sh
headless-serve-sim status-bar override --time 9:41 --battery-level 100 --battery-state charged \
  --wifi-bars 3 --cellular-bars 4 -d "$UDID"

for look in light dark; do
  headless-serve-sim ui appearance "$look" -d "$UDID"
  sleep 1
  headless-serve-sim screenshot "/tmp/home-$look.png" -d "$UDID"
done

headless-serve-sim ui text-size accessibility-large -d "$UDID"
sleep 1
headless-serve-sim screenshot /tmp/home-ax-large.png -d "$UDID"

# Restore
headless-serve-sim ui text-size large -d "$UDID"
headless-serve-sim ui appearance light -d "$UDID"
headless-serve-sim status-bar clear -d "$UDID"
```

Add `headless-serve-sim rotate landscape_left -d "$UDID"` (then confirm it with `/config`, see [buttons-rotation.md](buttons-rotation.md)) to capture landscape. On a foldable, add `headless-serve-sim motion angle 130 -d "$UDID"` to capture the book pose.

## 7. Show the simulator to a human

When the user wants to *see* the simulator ("show me", "open the preview", "let me watch"), give them the browser preview. `--detach` alone is not enough, because it only starts the stream helper and has no UI.

```sh
# Start the preview server in the background and capture its URL
LOG=$(mktemp)
headless-serve-sim "$UDID" >"$LOG" 2>&1 &     # add -p <port> to pin a port
PREVIEW_PID=$!
for i in $(seq 1 120); do
  URL=$(grep -Eo 'Local: +http://[^ ]+' "$LOG" | awk '{print $2}')
  [ -n "$URL" ] && break
  sleep 0.5
done
echo "Simulator preview: $URL"               # e.g. http://localhost:3200
```

Then:

1. **Print the URL plainly** in your reply, so the user always has a manual fallback.
2. **If your host has a preview or browser tool**, open the URL with it. Examples are a `preview_start`-style tool, an MCP browser, or an `open_url` tool. Only call tools that actually exist in your current toolset; never invent a tool name. If there is none, ask the user to open the URL in a browser, or run `open "$URL"` with their consent.
3. **For a phone**, the toolbar's "Preview on phone" button shows a QR code that opens the stream on a device on the same Wi-Fi.
4. **For a remote reviewer**, a tunnel to the preview port works. Bind with `--host` only on a trusted network (see [endpoints.md](endpoints.md#security-notes)).

The preview keeps running until you stop it with `kill $PREVIEW_PID`. The device's helper keeps running after the preview exits, so also run `headless-serve-sim --kill "$UDID"` if you are finished with it. Several viewers can watch the same preview at once.

Quick decision tree:

- No `- Local:` line? Read `$LOG` and report the error (for example, a busy pinned port or a device that could not be resolved).
- Is there a preview or browser tool in your toolset? Use it and also print the URL.
- No such tool? Print the URL and tell the user how to open it.
