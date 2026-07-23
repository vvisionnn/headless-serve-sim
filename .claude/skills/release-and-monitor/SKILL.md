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

Release the `headless-serve-sim` package the way this repo already does it: a version bump
commit + a lightweight `vX.Y.Z` tag on **main**, pushed to `origin`. The push is the only
trigger — **GitHub Actions owns publishing the GitHub Release from the tag push**. This
skill never publishes anything itself.

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
- Only `packages/headless-serve-sim/package.json` is bumped (matches the repo's history).

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

The bundled engine does the whole deterministic release atomically (preflight → bump →
commit → tag → push). Preview first, then run for real.

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

- Tags are lightweight `vX.Y.Z`, commit message `chore(release): X.Y.Z` (no `[skip ci]` — CI
  must run). This matches the repo's existing releases exactly.
- Everything mutating lives in `scripts/bump-tag-release.ts`; monitoring lives in
  `scripts/check-release.ts`. Both run under `bun` and re-check their own preconditions, so
  they're safe to re-run.
