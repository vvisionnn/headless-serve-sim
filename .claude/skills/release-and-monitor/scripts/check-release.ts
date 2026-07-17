#!/usr/bin/env bun
/**
 * release-and-monitor — release status checker.
 *
 * Inspects the GitHub Actions runs (and the GitHub Release) produced by a pushed
 * `vX.Y.Z` tag / release commit, and reduces them to a single verdict so the
 * `/loop`-based monitor can decide whether to stop, keep waiting, or self-heal.
 *
 * Usage:
 *   bun check-release.ts <tag> [--repo <path>] [--sha <sha>]
 *
 * Exit codes (consumed by the monitor):
 *   0  success  — every run for the commit concluded ok AND the GitHub Release exists
 *   2  pending  — runs still queued/in-progress (or not registered yet)
 *   1  failure  — at least one run failed/cancelled/timed-out
 *   3  error    — gh unavailable / not authenticated / bad input
 *
 * A single JSON verdict is written to stdout; human progress goes to stderr.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const OK = new Set(["success", "skipped", "neutral"]);
const BAD = new Set(["failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"]);

interface Run {
	databaseId: number;
	name?: string;
	workflowName?: string;
	status?: string; // queued | in_progress | completed | waiting | requested | pending
	conclusion?: string | null;
	event?: string;
	url?: string;
}

function die(state: "error", msg: string): never {
	console.error(`✗ ${msg}`);
	console.log(JSON.stringify({ state, message: msg }));
	process.exit(3);
}

function parseArgs(argv: string[]): { tag: string; repo: string; sha?: string } {
	let tag = "";
	let repo = "";
	let sha: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--repo") repo = argv[++i] ?? "";
		else if (a === "--sha") sha = argv[++i];
		else if (!a.startsWith("-") && !tag) tag = a;
		else die("error", `unrecognized argument: ${a}`);
	}
	if (!tag) die("error", "missing <tag> (e.g. v0.0.21)");
	if (!repo) {
		try {
			repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
		} catch {
			die("error", "not in a git repo and no --repo given");
		}
	}
	return { tag, repo: resolve(repo), sha };
}

function run(cmd: string, args: string[], cwd: string, allowFail = false): string {
	try {
		return execFileSync(cmd, args, { cwd, encoding: "utf8" }).trim();
	} catch (e: unknown) {
		if (allowFail) return "";
		const err = e as { stderr?: Buffer; message?: string };
		die("error", `${cmd} ${args.join(" ")} failed: ${err.stderr?.toString().trim() || err.message || String(e)}`);
	}
}

const { tag, repo, sha: shaArg } = parseArgs(process.argv.slice(2));

// gh present + authenticated?
try {
	execFileSync("gh", ["auth", "status"], { cwd: repo, stdio: "ignore" });
} catch {
	die("error", "GitHub CLI (gh) is not available or not authenticated — run `gh auth login`.");
}

// resolve the commit the tag points at
const sha = shaArg ?? run("git", ["-C", repo, "rev-list", "-n", "1", tag], repo, true);
if (!sha) die("error", `cannot resolve commit for tag ${tag} (is it fetched?)`);

// runs for that commit
const raw = run("gh", ["run", "list", "--commit", sha, "-L", "50", "--json", "databaseId,name,workflowName,status,conclusion,event,url"], repo);
let runs: Run[] = [];
try {
	runs = JSON.parse(raw || "[]");
} catch {
	die("error", "could not parse `gh run list` output");
}

// does the GitHub Release exist yet?
const releaseExists = run("gh", ["release", "view", tag, "--json", "tagName"], repo, true) !== "";

const failed = runs.filter((r) => r.status === "completed" && BAD.has(r.conclusion ?? ""));
const pending = runs.filter((r) => r.status !== "completed");
const succeeded = runs.filter((r) => r.status === "completed" && OK.has(r.conclusion ?? ""));

let state: "success" | "pending" | "failure";
let exit: number;
if (failed.length > 0) {
	state = "failure";
	exit = 1;
} else if (runs.length === 0 || pending.length > 0) {
	state = "pending";
	exit = 2;
} else if (!releaseExists) {
	// all runs green but the Release object hasn't been cut yet — give it another cycle
	state = "pending";
	exit = 2;
} else {
	state = "success";
	exit = 0;
}

const verdict = {
	state,
	tag,
	sha,
	releaseExists,
	counts: { total: runs.length, succeeded: succeeded.length, pending: pending.length, failed: failed.length },
	failedRuns: failed.map((r) => ({ id: r.databaseId, name: r.workflowName ?? r.name, url: r.url })),
};

const label = { success: "✓ SUCCESS", pending: "… PENDING", failure: "✗ FAILURE" }[state];
console.error(`${label} — ${tag} @ ${sha.slice(0, 9)}: ${succeeded.length} ok / ${pending.length} pending / ${failed.length} failed · release=${releaseExists}`);
for (const f of verdict.failedRuns) console.error(`   failed: ${f.name} → ${f.url}`);
console.log(JSON.stringify(verdict));
process.exit(exit);
