# Device settings, capture and app actions reference

These commands work on any **booted** simulator; no helper or preview server is needed. Each one targets `-d <UDID|name>`, or the first booted simulator (preferring iOS) when `-d` is left out. Pass `-d` whenever more than one simulator is booted.

Run `permissions`, `document`, `status-bar`, `defaults` or `app-actions` with no arguments to print its usage; they reject `--help` with "Unknown flag". `ui` and `motion` print their current status with no arguments and accept `--help`. `screenshot` with no arguments captures to `./screenshot-<timestamp>.png`.

## Contents

- Screenshots and recordings
- UI settings (appearance and accessibility)
- Status bar
- User defaults
- App actions (URLs, push, keychain)
- Files app documents
- Motion (foldables and physical orientation)
- Logs

## Screenshots and recordings

```sh
headless-serve-sim screenshot /tmp/home.png -d "$UDID"
headless-serve-sim screenshot /tmp/home.jpg --type jpeg -d "$UDID"
headless-serve-sim screenshot --display external --mask black -d "$UDID"
```

- `[path]` defaults to `./screenshot-<timestamp>.png`.
- `--type png|jpeg|tiff|bmp` sets the image format.
- `--display <id|internal|external>` picks a display. On foldables the panels are separate displays.
- `--mask ignored|alpha|black` controls how the rounded corners and cutouts are rendered.

The capture is at full device resolution and does not include a device frame. It wraps `xcrun simctl io <UDID> screenshot`. To check what is on screen, take a screenshot and read the image file. Do not grab frames from the video stream.

For **video**, use `xcrun simctl io "$UDID" recordVideo /tmp/run.mp4` and stop it with Ctrl-C or SIGINT. The preview UI's Capture tab can also record, with touches and the device frame, for humans.

To get stable screenshots of animations, slow them down first with `headless-serve-sim ca-debug slow-animations on` (see [ca-debug.md](ca-debug.md)).

## UI settings (appearance and accessibility)

```sh
headless-serve-sim ui --json -d "$UDID"            # every option's current value
headless-serve-sim ui appearance dark -d "$UDID"
headless-serve-sim ui text-size accessibility-large -d "$UDID"
headless-serve-sim ui text-size increment -d "$UDID"
headless-serve-sim ui reduce-motion on -d "$UDID"
headless-serve-sim ui voiceover on -d "$UDID"
```

| Option | Values |
|---|---|
| `appearance` | `light` or `dark` |
| `liquid-glass` | `clear` or `tinted` |
| `color-filter` | `none`, `grayscale`, `red-green`, `green-red` or `blue-yellow` (also accepts `protanopia`, `deuteranopia`, `tritanopia`) |
| `text-size` | the 12 content-size categories (`extra-small` … the accessibility sizes), or `increment` / `decrement` |
| `reduce-motion` | `on` or `off` |
| `increase-contrast` | `on` or `off` |
| `show-borders` | `on` or `off` |
| `reduce-transparency` | `on` or `off` |
| `voiceover` | `on` or `off` |

`ui <option>` with no value prints the current value. Running apps pick up these changes live.

To test accessibility, combine `ui` with the accessibility tree from `<helper>/ax`. Checking `AXLabel`, `AXValue` and `AXUniqueId` is usually more reliable than turning VoiceOver on.

## Status bar

```sh
headless-serve-sim status-bar override --time 9:41 --battery-level 100 --battery-state charged \
  --wifi-bars 3 --cellular-bars 4 --data-network 5g -d "$UDID"
headless-serve-sim status-bar clear -d "$UDID"
```

Override flags (at least one is required):

- `--time <9:41|ISO8601>`
- `--operator-name <str>`
- `--data-network <hide|wifi|3g|4g|lte|lte-a|lte+|5g|5g+|5g-uwb|5g-uc>`
- `--wifi-mode <searching|failed|active>`
- `--wifi-bars <0-3>`
- `--cellular-mode <notSupported|searching|failed|active>`
- `--cellular-bars <0-4>`
- `--battery-state <charging|charged|discharging>`
- `--battery-level <0-100>`

Run `clear` when you are done; overrides persist until then.

## User defaults

```sh
headless-serve-sim defaults read com.example.app -d "$UDID"
headless-serve-sim defaults write com.example.app hasOnboarded --type bool true -d "$UDID"
headless-serve-sim defaults write group.com.example.shared apiBase --type string https://staging.example.com -d "$UDID"
headless-serve-sim defaults delete com.example.app hasOnboarded -d "$UDID"
```

The domain is a bundle id (for standard preferences) or a suite or App Group id. `--type` is `string`, `int`, `float` or `bool`. Relaunch the app (`xcrun simctl terminate` then `launch`) if it caches its preferences.

This is useful for skipping onboarding, flipping feature flags or pointing a build at another backend before a test.

## App actions (URLs, push, keychain)

```sh
headless-serve-sim app-actions open-url "myapp://settings" -d "$UDID"
headless-serve-sim app-actions open-url "https://example.com/universal/link" -d "$UDID"
headless-serve-sim app-actions push com.example.app --payload '{"aps":{"alert":"Hello","badge":1}}' -d "$UDID"
headless-serve-sim app-actions push com.example.app --file push.apns -d "$UDID"
headless-serve-sim app-actions keychain-reset -d "$UDID"
```

- `open-url` accepts custom schemes and http(s) or universal links. It is equivalent to `xcrun simctl openurl`.
- `push` needs the target app installed and a payload with an `aps` dictionary. Grant the notification permission first (`permissions grant notifications <bundle-id>`) if the alert should be visible.
- `keychain-reset` wipes the simulator's keychain for every app.

## Files app documents

```sh
headless-serve-sim document import ./fixtures/report.pdf ./fixtures/photo.heic --into Inbox -d "$UDID"
```

This imports one or more files into the Files app under **On My iPhone/iPad**, optionally inside a subfolder. To add photos to the Photos library instead, use `xcrun simctl addmedia "$UDID" <files…>`.

## Motion (foldables and physical orientation)

```sh
headless-serve-sim motion --json -d "$UDID"                 # status: hinge angle, pose, orientation
headless-serve-sim motion angle 0 -d "$UDID"                # closed
headless-serve-sim motion angle 130 -d "$UDID"              # book pose
headless-serve-sim motion angle 180 -d "$UDID"              # fully open
headless-serve-sim motion orientation faceUp -d "$UDID"
```

- `angle <0..180>` sets the hinge of a foldable (the iPhone Duo).
- `orientation` sets the physical device orientation that CoreMotion reports: `portrait`, `portraitUpsideDown`, `landscapeLeft`, `landscapeRight`, `faceUp` or `faceDown`.

This is different from `rotate`, which changes the interface orientation. Use `motion` to test fold-aware layouts and motion-driven features.

## Logs

The CLI has no log command. Use Apple's tooling:

```sh
xcrun simctl spawn "$UDID" log stream --style compact \
  --predicate 'subsystem == "com.example.app"' --level debug
```

The preview UI's Console has a Logs view with search, process filtering and level selection, for humans. `headless-serve-sim events -p <preview-port>` prints the **input** events sent from the preview page (what a human tapped), not app logs.
