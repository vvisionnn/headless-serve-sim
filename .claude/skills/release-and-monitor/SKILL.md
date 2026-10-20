---
name: release-and-monitor
description: >-
  Cut a new headless-serve-sim release from main and watch it land. Bumps the version,
  commits chore(release), creates the vX.Y.Z tag, and pushes so GitHub Actions build and
  publish; then monitors CI on a 5-minute /loop and self-heals (diagnose → fix → re-release)
  until the release is green. Invoke with /release-and-monitor [version]. Optional arg: an
  explicit X.Y.Z to release; omit it to auto-bump the patch. ALWAYS operates on main and
  NEVER switches branches.
argument-hint: "[version]"
arguments: [version]
disable-model-invocation: true
allowed-tools: Bash(git fetch:*), Bash(git status:*), Bash(git worktree list:*), Bash(git tag:*), Bash(git show:*), Bash(git rev-parse:*), Bash(git log:*), Bash(gh auth status:*), Bash(gh run list:*), Bash(gh run view:*), Bash(gh release view:*), Bash(bun ${CLAUDE_SKILL_DIR}/scripts/bump-tag-release.ts:*), Bash(bun ${CLAUDE_SKILL_DIR}/scripts/check-release.ts:*)
---

# release-and-monitor

Release headless-serve-sim the way this repo already does it: a version-bump commit and a
lightweight `vX.Y.Z` tag on **main**, pushed to `origin`. The push is the only trigger.
**GitHub Actions publishes the GitHub Release from the tag push**, and this skill never
publishes anything itself. headless-serve-sim is not on npm. Users install the release asset
with mise (`mise use -g github:vvisionnn/headless-serve-sim`), so "released" means
"the GitHub Release exists with its tarball".

## What a release is

Every recent `chore(release): X.Y.Z` commit (0.0.32 onward) changes the same three version strings,
and nothing else:

| File | Field |
| --- | --- |
| `packages/headless-serve-sim/package.json` | `"version"` |
| `.claude-plugin/plugin.json` | `"version"`. The `plugin-manifest` test requires it to equal the package version. |
| `bun.lock` | `"version"` under `"packages/headless-serve-sim"`. CI installs with `--frozen-lockfile`. |

That commit gets the tag `vX.Y.Z`, and both are pushed to `origin`. `.github/workflows/ci.yml`
then runs:

1. The `check` job on Linux: static checks and client tests.
2. The `build-test` job on `macos-26`: build, headless-serve-sim tests and Swift self-tests.
   On a `v*` tag this job also packages `headless-serve-sim-darwin-arm64.tar.gz`, which
   contains `headless-serve-sim`, `simcam/`, `simax/`, `simmotion/` and `native-sources/`.
3. The `release` job (`softprops/action-gh-release`): attaches the tarball to the GitHub
   Release for the tag.

`publish.yml` and `publish-stable.yml` are leftover npm workflows from the upstream project.
They are gated on the upstream repository, so their publish jobs never run here. Ignore them.

Then it stays with the release: it polls CI every 5 minutes and, if a run fails, fixes the
cause and cuts another version, repeating until the release is green.

## Current state (auto-collected on invoke)

- Current branch: !`git rev-parse --abbrev-ref HEAD 2>/dev/null`
- Worktrees (the `[main]` one is where releases happen): !`git worktree list 2>/dev/null`
- Uncommitted changes here: !`git status --short 2>/dev/null`
- Newest tags: !`git tag --list 'v*' --sort=-v:refname 2>/dev/null | head -5`
- Version committed on main: !`git show main:packages/headless-serve-sim/package.json 2>/dev/null | grep '"version"' | head -1`
- gh auth: !`gh auth status 2>&1 | head -2`

## Invariants — read these first

These are the rules the user cares about; the bundled script enforces them too, but honor
them in how you drive it:

- **The release always happens on `main`, in the worktree that has `main` checked out.**
- **Never switch branches and never `git checkout`.** This is a multi-worktree repo; moving
  the current worktree's branch would disrupt other work. If you aren't on main, you operate
  on the *main worktree* by pointing the script at it with `--repo <path>` — you do not move.
- **Never bump/tag on a non-main branch or worktree.**
- **Publishing is 100% GitHub Actions.** Do not publish manually or run
  `gh workflow run` — pushing the branch and tag is the whole job.
- A release commit bumps exactly the three files in "What a release is". It bumps them
  together and changes nothing else.

`$version` is optional. If the user gave one, release exactly that `X.Y.Z`. If it's empty,
auto-bump the patch. An explicit version applies to the **first** release only; any
self-heal re-release auto-bumps (a failed version's tag can't be reused).

## Step 0 — Resolve the target (main), never switch

Look at "Current branch" above.

- **On `main`** → the target repo is this worktree. Proceed silently; do not ask anything.
- **Not on `main`** → find the main worktree: in the "Worktrees" list, the line tagged
  `[main]` is its path. Then show the user a **notice** with `AskUserQuestion`:
  - question: something like *"You're on `<branch>`, not main. This skill releases on main
    (worktree `<path>`). Proceed?"*
  - options: **[Proceed on main]** and **[Abort]**.
  - On *Proceed*, run every command below with `--repo <main-worktree-path>` — you stay on
    your current branch the entire time. On *Abort*, stop.
- **No worktree has `main` checked out** → tell the user you can't release without switching
  branches (which this skill won't do), and stop. Ask them to check out main somewhere.

In the commands below, `<repo>` means the target worktree: omit `--repo` when you're already
on main, otherwise pass `--repo <main-worktree-path>`.

## Step 1 — Bump, commit, tag, push

The bundled engine runs the whole release in order (preflight → bump → commit → tag → push).
Preview first, then run for real.

> **Known gap:** `scripts/bump-tag-release.ts` currently bumps and commits only
> `packages/headless-serve-sim/package.json` (`PKG_REL`). A commit made that way leaves
> `.claude-plugin/plugin.json` and `bun.lock` behind, and CI then fails. Until the engine
> also bumps those two files, follow these steps:
>
> 1. Use the engine only with `--dry-run`, for its preflight checks and the next version.
> 2. Tell the user you are releasing by hand.
> 3. Edit the three version strings.
> 4. Run `git add packages/headless-serve-sim/package.json .claude-plugin/plugin.json bun.lock`.
> 5. Run `git commit -m "chore(release): X.Y.Z"`, then `git tag vX.Y.Z`.
> 6. Run `git push origin main`, then `git push origin vX.Y.Z`.
> 7. Take `sha` from `git rev-parse HEAD` for Step 2.
>
> The manual git commands are not in `allowed-tools`, so expect permission prompts. Every
> recent release commit (0.0.32 through 0.0.42) has this shape.

**Preview** (no changes made):

```
bun ${CLAUDE_SKILL_DIR}/scripts/bump-tag-release.ts <version-if-any> [--repo <repo>] --dry-run
```

Show the printed plan (base, next, tag, commit message). If it looks right, **release**:

```
bun ${CLAUDE_SKILL_DIR}/scripts/bump-tag-release.ts <version-if-any> [--repo <repo>]
```

Pass the explicit version as the first argument only if the user supplied one; otherwise omit
it (the engine bumps the patch from `max(highest v* tag, package.json version)`, so it never
collides with an existing tag even though package.json lags the tags).

The engine's own preflight will **stop** on any of: not on main, dirty tree, an in-progress
merge/rebase, `main` behind `origin/main`, or the target tag already existing. If it exits
non-zero, relay the error and stop — these are for the user to resolve (e.g. pull first,
commit/stash, pick a new version). Do not try to work around them.

On success it prints a JSON line on stdout — capture **`tag`** and **`sha`** for the next step.

## Step 2 — Monitor on a 5-minute loop

The push has triggered CI. Watch it with the built-in `/loop` at a 5-minute cadence, running
the bundled status checker each cycle. Start it like:

```
/loop 5m Run `bun ${CLAUDE_SKILL_DIR}/scripts/check-release.ts <tag> --repo <repo> --sha <sha>` and act on its exit code: SUCCESS(0) → tell me the release is live and stop this loop; PENDING(2) → say it's still running and keep waiting; FAILURE(1) → stop this loop and start self-heal; ERROR(3) → stop this loop and report the problem.
```

Fill in the real `<tag>`, `<repo>`, and `<sha>` from Step 1. The checker reduces all runs for
the commit (plus whether the GitHub Release exists) to one verdict:

- **exit 0 / `success`** → every run concluded ok and the Release was cut. Announce the
  released version and stop the loop. **Done.**
- **exit 2 / `pending`** → runs still queued/in-progress. Report briefly; the loop waits.
- **exit 1 / `failure`** → a run failed. Stop the loop and go to Step 3.
- **exit 3 / `error`** → gh missing/unauthenticated or bad input. Stop the loop and surface it.

If `/loop` is unavailable in the session, fall back to blocking on
`gh run watch <run-id> --exit-status` for the failing/relevant run instead.

## Step 3 — Self-heal, then re-release

When a run fails:

1. **Diagnose** — `gh run view <failed-run-id> --log-failed` (the id is in the checker's
   `failedRuns`). Read the actual failure.
2. **Fix on the current branch** — this is the target (main in the normal flow). Make the
   real code/config fix and commit it. Don't switch branches; don't paper over the failure.
3. **Re-release** — run Step 1 again with **no explicit version** so it auto-bumps to the
   next patch (new commit + new `vX.Y.Z` + push). A used version's tag can't be reused.
4. **Re-monitor** — go back to Step 2 with the new tag/sha.

Repeat until the release is green. Explain each fix as you go. If the *same* failure survives
~3 cycles, stop and ask the user for direction rather than spinning — repeated identical
failures mean the fix needs a human decision.

## Notes

- Tags are lightweight `vX.Y.Z`, and the commit message is `chore(release): X.Y.Z` with no
  `[skip ci]`, because CI must run. This matches the repo's existing releases exactly.
- A release is green when `ci.yml` passes for the tag and the GitHub Release has
  `headless-serve-sim-darwin-arm64.tar.gz` attached. That asset is what mise's `github:` backend
  installs.
- Everything mutating lives in `scripts/bump-tag-release.ts`; monitoring lives in
  `scripts/check-release.ts`. Both run under `bun` and re-check their own preconditions, so
  they're safe to re-run.
