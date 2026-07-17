#!/usr/bin/env bun
/**
 * release-and-monitor — deterministic release engine.
 *
 * Bumps packages/headless-serve-sim/package.json, commits a `chore(release): X.Y.Z`,
 * creates a lightweight `vX.Y.Z` tag, and pushes the branch + tag to the remote.
 *
 * It ALWAYS operates on `main`, in whichever worktree has `main` checked out (pass it
 * via --repo). It never switches branches. Publishing is left entirely to GitHub Actions
 * (the push of the branch/tag is what triggers the workflows).
 *
 * Runs under `bun` or `node` (only node built-ins are used).
 *
 * Usage:
 *   bun bump-tag-release.ts [<version> | patch | minor | major] [--repo <path>]
 *                           [--remote <name>] [--dry-run]
 *
 *   <version>   explicit X.Y.Z (or vX.Y.Z) — used verbatim.
 *   patch|minor|major   bump level when no explicit version is given (default: patch).
 *   --repo      worktree to operate in; must be on `main`. Default: git toplevel of cwd.
 *   --remote    push target. Default: origin.
 *   --dry-run   run every check + print the plan, but make no commit/tag/push.
 *
 * Human-readable progress goes to stderr; a single machine-readable JSON summary is the
 * only thing written to stdout (so callers can capture the resulting version/tag/sha).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const PKG_REL = "packages/headless-serve-sim/package.json";
const BRANCH = "main";
const IN_PROGRESS_MARKERS = [
	"MERGE_HEAD",
	"CHERRY_PICK_HEAD",
	"REVERT_HEAD",
	"rebase-merge",
	"rebase-apply",
];

type Level = "patch" | "minor" | "major";
type SemVer = [number, number, number];

interface Args {
	version?: string; // explicit X.Y.Z, else undefined
	level: Level;
	repo: string;
	remote: string;
	dryRun: boolean;
}

function fail(msg: string): never {
	console.error(`✗ ${msg}`);
	process.exit(1);
}

function git(repo: string, args: string[], opts: { allowFail?: boolean } = {}): string {
	try {
		return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
	} catch (e: unknown) {
		if (opts.allowFail) return "";
		const err = e as { stderr?: Buffer; message?: string };
		fail(`git ${args.join(" ")} failed: ${err.stderr?.toString().trim() || err.message || String(e)}`);
	}
}

function parseSemver(v: string): SemVer | null {
	const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmp(a: SemVer, b: SemVer): number {
	return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function bump(v: SemVer, level: Level): SemVer {
	if (level === "major") return [v[0] + 1, 0, 0];
	if (level === "minor") return [v[0], v[1] + 1, 0];
	return [v[0], v[1], v[2] + 1];
}

function fmt(v: SemVer): string {
	return v.join(".");
}

function parseArgs(argv: string[]): Args {
	let version: string | undefined;
	let level: Level = "patch";
	let repo = "";
	let remote = "origin";
	let dryRun = false;

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--dry-run") dryRun = true;
		else if (a === "--repo") repo = argv[++i] ?? "";
		else if (a === "--remote") remote = argv[++i] ?? "origin";
		else if (a === "-h" || a === "--help") {
			console.error("Usage: bun bump-tag-release.ts [<version>|patch|minor|major] [--repo <path>] [--remote <name>] [--dry-run]");
			process.exit(0);
		} else if (a === "patch" || a === "minor" || a === "major") level = a;
		else if (/^v?\d+\.\d+\.\d+$/.test(a)) version = a.replace(/^v/, "");
		else fail(`unrecognized argument: ${a}`);
	}

	if (!repo) {
		try {
			repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
		} catch {
			fail("not inside a git repository and no --repo given.");
		}
	}
	return { version, level, repo: resolve(repo), remote, dryRun };
}

function preflight(args: Args): { base: SemVer; highestTag: SemVer; pkgVer: SemVer; pkgPath: string; pkgRaw: string; pkgCur: string } {
	const { repo, remote } = args;

	// git repo?
	git(repo, ["rev-parse", "--git-dir"]);

	// on main? (a worktree checked out on main IS the main worktree)
	const branch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
	if (branch !== BRANCH) {
		fail(`target worktree '${repo}' is on '${branch}', not '${BRANCH}'. This skill only releases on ${BRANCH}; never switch branches.`);
	}

	// no half-finished merge/rebase/cherry-pick/revert
	for (const marker of IN_PROGRESS_MARKERS) {
		const p = git(repo, ["rev-parse", "--git-path", marker]);
		const abs = isAbsolute(p) ? p : join(repo, p);
		if (existsSync(abs)) fail(`a git operation is in progress (${marker}); finish or abort it before releasing.`);
	}

	// clean working tree — the release commit must contain only the version bump
	const dirty = git(repo, ["status", "--porcelain"]);
	if (dirty) fail(`working tree is not clean:\n${dirty}\nCommit or stash changes before releasing.`);

	// remote configured?
	git(repo, ["remote", "get-url", remote]);

	// refresh tags + remote tracking ref
	console.error(`→ git fetch --tags --prune ${remote}`);
	git(repo, ["fetch", "--tags", "--prune", remote]);

	// local main must not be behind remote/main (else the push is rejected)
	const hasRemoteMain = git(repo, ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${BRANCH}`], { allowFail: true });
	if (hasRemoteMain) {
		const behind = git(repo, ["rev-list", "--count", `${BRANCH}..${remote}/${BRANCH}`]);
		if (behind !== "0") fail(`local ${BRANCH} is behind ${remote}/${BRANCH} by ${behind} commit(s). Pull/rebase ${BRANCH} first.`);
	}

	// highest existing vX.Y.Z tag
	let highestTag: SemVer = [0, 0, 0];
	for (const t of git(repo, ["tag", "--list", "v*"]).split("\n").filter(Boolean)) {
		const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(t);
		if (m) {
			const s: SemVer = [Number(m[1]), Number(m[2]), Number(m[3])];
			if (cmp(s, highestTag) > 0) highestTag = s;
		}
	}

	// package.json version
	const pkgPath = join(repo, PKG_REL);
	if (!existsSync(pkgPath)) fail(`${PKG_REL} not found under ${repo}.`);
	const pkgRaw = readFileSync(pkgPath, "utf8");
	let pkgCur: string;
	try {
		pkgCur = String(JSON.parse(pkgRaw).version ?? "0.0.0");
	} catch {
		return fail(`${PKG_REL} is not valid JSON.`);
	}
	const pkgVer = parseSemver(pkgCur) ?? [0, 0, 0];

	// base = the higher of (highest tag, committed package version) — avoids colliding
	// with an existing tag when package.json lags behind the tags (or vice-versa).
	const base = cmp(highestTag, pkgVer) >= 0 ? highestTag : pkgVer;
	return { base, highestTag, pkgVer, pkgPath, pkgRaw, pkgCur };
}

function main(): void {
	const args = parseArgs(process.argv.slice(2));
	const { repo, remote, dryRun } = args;

	const { base, highestTag, pkgVer, pkgPath, pkgRaw, pkgCur } = preflight(args);

	// next version
	let next: SemVer;
	if (args.version) {
		const explicit = parseSemver(args.version);
		if (!explicit) fail(`invalid version '${args.version}'.`);
		next = explicit;
		if (cmp(next, base) <= 0) {
			console.error(`⚠ requested ${fmt(next)} is not greater than current ${fmt(base)} (max of tag/package.json). Proceeding as requested.`);
		}
	} else {
		next = bump(base, args.level);
	}
	const nextStr = fmt(next);
	const tagName = `v${nextStr}`;

	// the tag must be new, locally and on the remote
	if (git(repo, ["rev-parse", "--verify", "--quiet", `refs/tags/${tagName}`], { allowFail: true })) fail(`tag ${tagName} already exists locally.`);
	if (git(repo, ["ls-remote", "--tags", remote, `refs/tags/${tagName}`])) fail(`tag ${tagName} already exists on ${remote}.`);

	const plan = {
		repo,
		branch: BRANCH,
		remote,
		currentTag: cmp(highestTag, [0, 0, 0]) > 0 ? `v${fmt(highestTag)}` : "(none)",
		packageVersion: fmt(pkgVer),
		base: fmt(base),
		next: nextStr,
		tag: tagName,
		commitMessage: `chore(release): ${nextStr}`,
	};
	console.error("Release plan:\n" + JSON.stringify(plan, null, 2));

	if (dryRun) {
		console.error("Dry run — no changes made.");
		console.log(JSON.stringify({ ...plan, dryRun: true }));
		return;
	}

	// bump via targeted string replace so all other formatting is preserved verbatim
	const replaced = pkgRaw.replace(`"version": "${pkgCur}"`, `"version": "${nextStr}"`);
	if (replaced === pkgRaw) fail(`could not find "version": "${pkgCur}" in ${PKG_REL} to update.`);
	writeFileSync(pkgPath, replaced);

	git(repo, ["add", PKG_REL]);
	git(repo, ["commit", "-m", `chore(release): ${nextStr}`]);
	git(repo, ["tag", tagName]);
	const sha = git(repo, ["rev-parse", "HEAD"]);

	console.error(`→ git push ${remote} ${BRANCH}`);
	git(repo, ["push", remote, BRANCH]);
	console.error(`→ git push ${remote} ${tagName}`);
	git(repo, ["push", remote, tagName]);

	console.error(`✓ Released ${tagName} (${sha.slice(0, 9)}) — pushed ${BRANCH} + tag to ${remote}. GitHub Actions will build/publish.`);
	console.log(JSON.stringify({ ...plan, sha, pushed: true }));
}

main();
