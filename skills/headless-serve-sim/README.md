# headless-serve-sim agent skill

A portable [Agent Skill](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) that teaches AI coding agents to drive an Apple Simulator via the [headless-serve-sim](https://github.com/vvisionnn/headless-serve-sim) CLI.

Works in Claude Code, Cursor, Codex CLI, Gemini CLI, GitHub Copilot, and any other tool that implements the open Agent Skills standard. The same `SKILL.md` works across all of them without modification.

## What it does

Once installed, your agent knows how to:

- Tap at normalized coordinates (`headless-serve-sim tap`).
- Send multi-touch / drag / swipe gestures with the correct JSON shape and edge flags.
- Press the six valid hardware buttons (`home`, `swipe_home`, `app_switcher`, `lock`, `siri`, `side_button`).
- Rotate the simulator (`portrait`, `portrait_upside_down`, `landscape_left`, `landscape_right`).
- Inject a synthetic camera feed (placeholder, image, video, or live webcam) with mirror-mode control.
- Toggle CoreAnimation debug overlays (blended layers, off-screen rendering, slow animations, …).
- Simulate a memory warning.
- Discover the running stream's URL and read the simulator's accessibility tree to find UI elements.
- Hand the stream URL off to the host agent's preview pane (`preview_start` in Claude Code, equivalents elsewhere) so the user sees the simulator inline.

It also teaches the agent the **gotchas** (use `tap`, not `gesture`, for plain taps), the **prerequisites** (Apple Silicon Mac, Xcode CLI tools, Node 18+, macOS 14+ for camera), and **anti-patterns** to avoid.

## Install

The skill lives in this repo under `skills/headless-serve-sim/`, so it is discoverable by the Agent Skills tooling directly from the headless-serve-sim repository.

### Agents that support the Agent Skills standard (Claude Code, Cursor, Codex CLI, Gemini CLI, …)

```sh
bunx add-skill vvisionnn/headless-serve-sim
```

### Manual install

Copy this folder into your agent's skills directory:

```sh
# from a clone of this repo
cp -r skills/headless-serve-sim ~/.claude/skills/headless-serve-sim
# or for other agents: ~/.agents/skills/headless-serve-sim, ~/.cursor/skills/headless-serve-sim, etc.
```

The skill is a folder with a `SKILL.md` file plus reference documents. No build step.

## Prerequisites on the user's machine

The agent checks these for you, but for reference:

- Apple Silicon Mac (arm64).
- Xcode command line tools (`xcode-select --install`).
- Node.js 18+ for the skill's helper scripts.
- The `headless-serve-sim` binary from the latest GitHub release, available on `PATH`.
- macOS 14+ if you want camera injection.
- At least one booted iOS, iPad, or Apple Watch simulator.

Download the CLI from the repository's [latest GitHub release](https://github.com/vvisionnn/headless-serve-sim/releases/latest).

## How it's structured

```
headless-serve-sim/
├── SKILL.md                          (loaded when the skill triggers)
├── references/
│   ├── gestures.md                   (gesture JSON, edges, multi-touch, recipes)
│   ├── buttons-rotation.md           (the six buttons, the four orientations)
│   ├── camera.md                     (camera injection: sources, mirroring, hot-swap)
│   ├── ca-debug.md                   (CoreAnimation debug flags)
│   ├── endpoints.md                  (HTTP + WebSocket surface)
│   └── workflows.md                  (end-to-end recipes incl. preview handoff)
├── scripts/
│   ├── check-prereqs.sh              (verify host satisfies requirements)
│   └── ensure-running.sh             (idempotent start of the helper)
└── evals/
    └── evals.json                    (6 test prompts for agent quality)
```

Following Anthropic's recommended structure: short `SKILL.md`, references one level deep, executable scripts that the agent can run without loading their source into context.

## Designed around progressive disclosure

- **Discovery**: only the `name` and `description` from the frontmatter cost tokens at startup.
- **Activation**: when the agent decides the task matches, it reads `SKILL.md`.
- **Execution**: it reads only the reference files relevant to the current task.

This keeps context usage low across hundreds of installed skills.

## Source of truth

Every claim in this skill — the six button names, the four orientations, the gesture JSON shape, the edge values, the HTTP endpoints — was verified against the headless-serve-sim source at the time of authoring. The skill does not invent behavior the CLI does not expose. When the CLI changes, update the skill and the `evals/` alongside it.

## Evals

`evals/evals.json` contains six representative prompts with expected behaviors, suitable for running through Anthropic's `skill-creator` eval framework. When changing the skill, re-run the evals to catch regressions.

## Contributing

Found a divergence between this skill and headless-serve-sim's actual behavior? Open an issue or PR on this repo.

Want to add a workflow recipe? Add it to `references/workflows.md` with an explanation of when an agent would use it, and add a matching eval to `evals/evals.json`.

## License

Apache-2.0, same as the rest of the headless-serve-sim repository.
