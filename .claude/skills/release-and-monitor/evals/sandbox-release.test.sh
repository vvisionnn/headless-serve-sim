#!/usr/bin/env bash
# Isolated end-to-end eval for the release engine. Creates a throwaway repo with a local
# bare "origin" (never touches the real repo or its remote) and exercises the happy path
# plus every preflight guard. Run: bash evals/sandbox-release.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../scripts/bump-tag-release.ts"
SB="$(mktemp -d /tmp/ram-sandbox.XXXXXX)"
trap 'rm -rf "$SB"' EXIT
export GIT_CONFIG_GLOBAL="$SB/gitconfig"
git config -f "$SB/gitconfig" user.email t@t.io
git config -f "$SB/gitconfig" user.name tester
git config -f "$SB/gitconfig" init.defaultBranch main
git config -f "$SB/gitconfig" commit.gpgsign false

git init -q --bare "$SB/origin.git"
git clone -q "$SB/origin.git" "$SB/repo"
cd "$SB/repo"
mkdir -p packages/headless-serve-sim
# package.json version (0.0.17) intentionally lags the tags (v0.0.20), like the real repo
printf '{\n  "name": "headless-serve-sim",\n  "version": "0.0.17",\n  "type": "module"\n}\n' \
  > packages/headless-serve-sim/package.json
git add -A && git commit -qm "init"
git push -q -u origin main
for v in 0.0.18 0.0.19 0.0.20; do git tag "v$v"; done
git push -q origin --tags

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; exit 1; }
ok()   { if bun "$SCRIPT" "$@" >/tmp/ram.out 2>/tmp/ram.err; then :; else cat /tmp/ram.err; fail "expected success ($*)"; fi; }
no()   { if bun "$SCRIPT" "$@" >/tmp/ram.out 2>/tmp/ram.err; then fail "expected failure ($*)"; fi; }

echo "== T1: dry-run patch -> base=max(v0.0.20,0.0.17)=0.0.20 -> next=0.0.21 =="
ok --dry-run; grep -q '"next":"0.0.21"' /tmp/ram.out && pass "next=0.0.21" || fail "wrong next"

echo "== T2: explicit 0.1.0 -> next=0.1.0 =="
ok 0.1.0 --dry-run; grep -q '"next":"0.1.0"' /tmp/ram.out && pass "honored explicit" || fail "wrong next"

echo "== T3: explicit below base warns but proceeds =="
ok 0.0.5 --dry-run; grep -q "not greater than current" /tmp/ram.err && pass "warned" || fail "no warn"

echo "== T4: duplicate tag (v0.0.20 exists) -> FAIL =="
no 0.0.20 --dry-run; grep -q "already exists" /tmp/ram.err && pass "blocked dup" || fail "wrong err"

echo "== T5: dirty tree -> FAIL =="
echo x > packages/headless-serve-sim/dirty.txt
no --dry-run; grep -q "not clean" /tmp/ram.err && pass "blocked dirty" || fail "wrong err"
rm packages/headless-serve-sim/dirty.txt

echo "== T6: off-main -> FAIL (never releases off main) =="
git checkout -q -b feature/foo
no --dry-run; grep -q "only releases on main" /tmp/ram.err && pass "blocked off-main" || fail "wrong err"
git checkout -q main

echo "== T7: behind origin/main -> FAIL =="
git clone -q "$SB/origin.git" "$SB/repo2"
git -C "$SB/repo2" commit -q --allow-empty -m "remote advance"
git -C "$SB/repo2" push -q origin main
no --dry-run; grep -q "is behind" /tmp/ram.err && pass "blocked behind" || fail "wrong err"
git pull -q --ff-only origin main

echo "== T8: --repo from unrelated cwd works (main-worktree-from-elsewhere) =="
( cd /tmp && ok --repo "$SB/repo" --dry-run ); grep -q '"next":"0.0.21"' /tmp/ram.out && pass "targeted main via --repo" || fail "wrong next"

echo "== T9: real release pushes branch+tag; re-release of same version blocked =="
ok
git ls-remote --tags origin v0.0.21 | grep -q v0.0.21 && pass "tag on origin" || fail "tag not pushed"
grep -q '"version": "0.0.21"' packages/headless-serve-sim/package.json && pass "package.json bumped" || fail "pkg not bumped"
[ "$(git log -1 --pretty=%s)" = "chore(release): 0.0.21" ] && pass "commit message" || fail "wrong commit msg"
no 0.0.21 --dry-run; grep -q "already exists" /tmp/ram.err && pass "re-release blocked" || fail "wrong err"

echo ""
echo "ALL SANDBOX EVALS PASSED"
