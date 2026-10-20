# Buttons and rotation reference

## Contents

- Button names
- Button notes
- Orientations
- Verifying a rotation
- Rotation notes

Both commands need a running helper (`headless-serve-sim --detach "$UDID"`) and accept `-d <UDID>` (names are not resolved).

## Button names

`headless-serve-sim button [name]` defaults to `home`. These are the only names the helper understands:

| Name | Effect |
|---|---|
| `home` | Home button press. Goes home, or wakes the device. |
| `swipe_home` | A bottom-edge swipe up (`edge=3`), the go-home gesture on Face ID devices. |
| `app_switcher` | Double Home press, about 150 ms apart. Opens the multitasking switcher. |
| `lock` | Power/sleep press. Locks or wakes the device. |
| `side_button` | Side button press (the same usage as `lock`). |
| `siri` | Holds the Siri button for about 300 ms, because Siri ignores a short tap. |
| `volume_up` | Volume up press. |
| `volume_down` | Volume down press. |

The CLI does not validate the name. An unknown name is sent anyway, and the helper logs `[hid] Unknown button: <name>` and does nothing, so the command appears to succeed. Check spelling against this table.

## Button notes

- **`home` vs `swipe_home`:** both go home on modern devices. `swipe_home` exercises the same edge-gesture recognizer a real user triggers on Face ID devices. `home` is the right choice on devices with a Home button.
- **Lock and wake:** `lock` locks the device, and a second `lock` (or `home`) wakes it to the Lock Screen, which is useful for testing Lock Screen widgets and notifications.
- **iPhone Duo:** on the foldable, hardware buttons go through the device's own HID services, so they behave like the physical buttons.
- **Apple Watch:** the CLI has no Digital Crown rotation command. In the preview UI, the mouse scroll wheel turns the crown.

## Orientations

`headless-serve-sim rotate <orientation>` accepts:

| Value | Meaning |
|---|---|
| `portrait` | Upright |
| `portrait_upside_down` | Upside down |
| `landscape_left` | Rotated 90° (landscape) |
| `landscape_right` | Rotated 90° the other way |

`rotate` works in headless mode with no Simulator.app window needed. On the iPhone Duo it sets the physical device orientation through the motion service. On other devices it sends an orientation event to the helper (WebSocket opcode `0x07`).

## Verifying a rotation

`rotate` returns as soon as the request is sent. It does **not** report whether iOS actually rotated, so check:

```sh
HELPER=$(jq -r .url "$TMPDIR/headless-serve-sim/server-$UDID.json")
headless-serve-sim rotate landscape_left -d "$UDID"
for i in $(seq 1 20); do
  O=$(curl -s "$HELPER/config" | jq -r '.interfaceOrientation // .orientation')
  [ "$O" = "landscape_left" ] || [ "$O" = "landscape_right" ] && break
  sleep 0.25
done
echo "interface orientation: $O"
```

`/config` reports `orientation` (the stream's orientation) and `interfaceOrientation` (what the app's interface is actually showing). Use `interfaceOrientation` when it is present. On composed views such as the Duo, `orientation` stays `portrait` because the composed video is always upright.

## Rotation notes

- **The app decides.** If its supported orientations are portrait only (`UISupportedInterfaceOrientations`), the device rotates but the interface does not. `portrait_upside_down` is unsupported on most iPhone apps.
- **Coordinates follow the screen.** After a rotation, keep sending what-you-see coordinates; the helper maps them onto the panel.
- **Apple Watch does not rotate.**
- **If nothing happens at all**, the helper log shows `Orientation request failed` or a `PurpleWorkspacePort not found` message. This usually means the device has not finished booting. Wait for `xcrun simctl bootstatus "$UDID" -b` and try again.
