# headless-serve-sim agent skill

An [Agent Skill](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) that teaches AI coding agents to boot, see and drive Apple simulators with the [headless-serve-sim](https://github.com/vvisionnn/headless-serve-sim) CLI. Supported devices are iPhone (including the foldable iPhone Duo), iPad and Apple Watch, and no Simulator.app window is needed.

The skill is general purpose and works in any project. It follows the open Agent Skills format, so the same folder works in Claude Code, Codex CLI, Cursor, Gemini CLI, GitHub Copilot and other compatible agents.

## What the agent learns

- **The mental model:**
  - the per-device helper, its state file (`$TMPDIR/headless-serve-sim/server-<UDID>.json`) and the preview server;
  - which commands need a helper and which work on any booted simulator;
  - why every call should carry `-d <UDID>`.
- **Input:**
  - `tap` (single-shot) versus `gesture` (one WebSocket per call, so a split begin/end becomes a long press);
  - swipes, edge gestures, a one-socket WebSocket client for flicks, and pinch;
  - typing;
  - the eight hardware buttons;
  - rotation, with verification through `/config`;
  - the foldable hinge and physical pose (`motion`).
- **Seeing the screen:**
  - `screenshot`;
  - the accessibility tree (`/ax`, normalized in points);
  - the foreground app (`/foreground`);
  - video recording with `simctl`.
- **Device state:**
  - privacy permissions, including push notifications;
  - `ui` (dark mode, text size, VoiceOver, reduce motion, …);
  - status-bar overrides;
  - user defaults;
  - deep links;
  - test pushes;
  - keychain reset;
  - Files-app imports;
  - camera injection (image, video, webcam);
  - CoreAnimation debug overlays;
  - memory warnings.
- **Humans in the loop:** starting the browser preview, handing its URL to the host's preview tool, and phone viewing via QR.
- **Parallel work:** one simulator per agent, port blocks, and scoped `--kill` and cleanup.

## Install the skill

### Claude Code plugin

This repository is also a Claude Code plugin marketplace:

```text
/plugin marketplace add vvisionnn/headless-serve-sim
/plugin install headless-serve-sim@headless-serve-sim
```

### Manual copy (any agent)

```sh
git clone https://github.com/vvisionnn/headless-serve-sim
cp -R headless-serve-sim/skills/headless-serve-sim ~/.claude/skills/        # Claude Code
# other agents: ~/.agents/skills/, ~/.codex/skills/, ~/.cursor/skills/, …
```

To share it with a team, copy the folder into a repository's `.claude/skills/` or `.agents/skills/` instead. The skill is plain Markdown plus two shell scripts, with no build step.

## Install the CLI

The skill drives the `headless-serve-sim` binary, which is distributed as GitHub release assets. It is not published to npm. With [mise](https://mise.jdx.dev):

```sh
mise use -g github:vvisionnn/headless-serve-sim
```

To pin it for one project, add it to that project's `mise.toml`:

```toml
[tools]
"github:vvisionnn/headless-serve-sim" = "latest"
```

Alternatively, download `headless-serve-sim-darwin-arm64.tar.gz` from the [latest release](https://github.com/vvisionnn/headless-serve-sim/releases/latest) and extract it somewhere on your `PATH`. Keep every folder from the archive (`simcam/`, `simax/`, `simmotion/` and `native-sources/`) next to the binary.

## Requirements

- An Apple Silicon Mac.
- Xcode 26 or newer, the full app rather than only the command line tools, with at least one simulator runtime installed. Xcode 27 is supported. The CLI boots simulators itself, so none needs to be running.
- macOS 14 or newer (normally already satisfied, since Xcode 26 requires a newer macOS).
- Node.js 18 or newer for this skill's helper scripts; `scripts/check-prereqs.sh` fails without it. The CLI itself does not need it.

## Layout

```text
skills/headless-serve-sim/
├── SKILL.md                      loaded when the skill triggers: model, decision table, gotchas
├── references/
│   ├── gestures.md               touch JSON, edges, swipes, one-socket client, pinch
│   ├── buttons-rotation.md       the eight buttons, four orientations, verifying rotation
│   ├── device-settings.md        screenshot/recording, ui, status-bar, defaults, app-actions, document, motion, logs
│   ├── permissions.md            privacy permissions incl. push notifications
│   ├── camera.md                 synthetic camera feeds, mirroring, hot-swap
│   ├── ca-debug.md               CoreAnimation debug overlays
│   ├── endpoints.md              helper and preview HTTP/WebSocket surface, state file, security
│   ├── parallel-agents.md        several simulators, parallel agents, ports, cleanup
│   └── workflows.md              end-to-end recipes incl. showing the preview to a human
├── scripts/
│   ├── check-prereqs.sh          verify the host before the first command
│   └── ensure-running.sh         start (or reuse) the stream helper for a device
└── evals/
    └── evals.json                prompts with expected agent behaviour
```

The skill uses progressive disclosure: only the frontmatter `description` is loaded at startup, `SKILL.md` is loaded when the skill triggers, and each reference file is read only when its task comes up.

## Keeping it accurate

Every command, flag, button name, orientation, endpoint and JSON shape in this skill was checked against the headless-serve-sim source. When the CLI changes, update the skill and `evals/evals.json` in the same change. To add a recipe, put it in `references/workflows.md`, explain when an agent should reach for it, and add a matching eval.

Found a mismatch between the skill and the CLI's actual behaviour? Open an issue or a pull request at [vvisionnn/headless-serve-sim](https://github.com/vvisionnn/headless-serve-sim).

## License

Apache-2.0, the same as the rest of the repository.
