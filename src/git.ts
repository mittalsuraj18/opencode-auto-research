// git.ts
// Git branch allocation, checkout, commit, reset, and dirty path operations.

import { $ } from "bun";
import {
	normalizePathSpec,
	normalizeStatusPath,
	parseDirtyPaths,
	relativizeGitPathToWorkDir,
} from "./helpers";

const AUTORESEARCH_BRANCH_PREFIX = "autoresearch/";
const BRANCH_NAME_MAX_LENGTH = 48;

export interface EnsureAutoresearchBranchFailure {
	error: string;
	ok: false;
}

export interface EnsureAutoresearchBranchSuccess {
	branchName: string | null;
	created: boolean;
	ok: true;
	warning?: string;
}

export type EnsureAutoresearchBranchResult =
	| EnsureAutoresearchBranchFailure
	| EnsureAutoresearchBranchSuccess;

export async function getCurrentBranch(workDir: string): Promise<string | null> {
	try {
		const result = await $`git -C ${workDir} rev-parse --abbrev-ref HEAD`.text();
		return result.trim() || null;
	} catch {
		return null;
	}
}

export function isAutoresearchBranch(branch: string | null): boolean {
	return branch !== null && branch.startsWith(AUTORESEARCH_BRANCH_PREFIX);
}

export async function ensureAutoresearchBranch(
	workDir: string,
	goal: string | null,
): Promise<EnsureAutoresearchBranchResult> {
	const repoRoot = await getRepoRoot(workDir);
	if (!repoRoot) {
		return {
			ok: true,
			branchName: null,
			created: false,
			warning:
				"Not in a git repository — autoresearch will run without branch isolation, baseline reset, or auto-commits.",
		};
	}

	let dirtyPathsOutput: string;
	try {
		dirtyPathsOutput = await $`git -C ${repoRoot} status --porcelain -z --untracked-files=all`.text();
	} catch (err) {
		return {
			ok: false,
			error: `Unable to inspect git status before starting autoresearch: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	const workDirPrefix = await readGitWorkDirPrefix(workDir);
	const dirtyPaths = collectRelativeDirtyPaths(dirtyPathsOutput, workDirPrefix);
	const currentBranch = await getCurrentBranch(workDir);
	if (currentBranch && isAutoresearchBranch(currentBranch)) {
		return { ok: true, branchName: currentBranch, created: false };
	}
	if (dirtyPaths.length > 0) {
		const preview = formatDirtyPaths(dirtyPaths);
		return {
			ok: false,
			error: `Worktree is dirty (${preview}). Commit or stash these changes before starting autoresearch — a fresh autoresearch/* branch needs a clean baseline.`,
		};
	}

	const branchName = await allocateBranchName(workDir, goal);
	try {
		await $`git -C ${workDir} checkout -b ${branchName}`.quiet();
	} catch (err) {
		return {
			ok: false,
			error: `Failed to create autoresearch branch ${branchName}: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	return { ok: true, branchName, created: true };
}

export async function getRepoRoot(workDir: string): Promise<string | null> {
	try {
		const result = await $`git -C ${workDir} rev-parse --show-toplevel`.text();
		return result.trim() || null;
	} catch {
		return null;
	}
}

async function readGitWorkDirPrefix(workDir: string): Promise<string> {
	try {
		const result = await $`git -C ${workDir} rev-parse --show-prefix`.text();
		return normalizePathSpec(result);
	} catch {
		return "";
	}
}

export function parseWorkDirDirtyPaths(statusOutput: string, workDirPrefix: string): string[] {
	const relativePaths: string[] = [];
	for (const dirtyPath of parseDirtyPaths(statusOutput)) {
		const relativePath = relativizeGitPathToWorkDir(dirtyPath, workDirPrefix);
		if (relativePath === null) continue;
		relativePaths.push(relativePath);
	}
	return relativePaths;
}

export function collectRelativeDirtyPaths(statusOutput: string, workDirPrefix: string): string[] {
	const dirtyPaths: string[] = [];
	for (const dirtyPath of parseDirtyPaths(statusOutput)) {
		const relativePath = relativizeGitPathToWorkDir(dirtyPath, workDirPrefix);
		dirtyPaths.push(relativePath ?? normalizeStatusPath(dirtyPath));
	}
	return dirtyPaths;
}

function formatDirtyPaths(paths: string[]): string {
	const preview = paths.slice(0, 5).join(", ");
	return paths.length > 5 ? `${preview} (+${paths.length - 5} more)` : preview;
}

async function allocateBranchName(workDir: string, goal: string | null): Promise<string> {
	const baseName = `${AUTORESEARCH_BRANCH_PREFIX}${slugifyGoal(goal)}-${currentDateStamp()}`;
	let candidate = baseName;
	let suffix = 2;
	while (await branchExists(workDir, candidate)) {
		candidate = `${baseName}-${suffix}`;
		suffix += 1;
	}
	return candidate;
}

async function branchExists(workDir: string, branchName: string): Promise<boolean> {
	try {
		await $`git -C ${workDir} show-ref --verify --quiet refs/heads/${branchName}`;
		return true;
	} catch {
		return false;
	}
}

function slugifyGoal(goal: string | null): string {
	const normalized = (goal ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const trimmed = normalized.slice(0, BRANCH_NAME_MAX_LENGTH).replace(/-+$/g, "");
	return trimmed || "session";
}

function currentDateStamp(): string {
	const now = new Date();
	const year = String(now.getFullYear());
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}${month}${day}`;
}

export async function gitCommit(workDir: string, message: string, files: string[]): Promise<string | null> {
	try {
		if (files.length > 0) {
			await $`git -C ${workDir} add ${files}`.quiet();
		} else {
			await $`git -C ${workDir} add -A`.quiet();
		}
		await $`git -C ${workDir} commit -m ${message}`.quiet();
		const hash = await $`git -C ${workDir} rev-parse HEAD`.text();
		return hash.trim();
	} catch (err) {
		return null;
	}
}

export async function gitResetHard(workDir: string): Promise<void> {
	try {
		await $`git -C ${workDir} reset --hard HEAD`.quiet();
	} catch {
		// Ignore errors
	}
}

export async function gitClean(workDir: string): Promise<void> {
	try {
		await $`git -C ${workDir} clean -fd`.quiet();
	} catch {
		// Ignore errors
	}
}

export async function gitRestoreFiles(workDir: string, files: string[]): Promise<void> {
	if (files.length === 0) return;
	try {
		await $`git -C ${workDir} restore --source=HEAD --staged --worktree ${files}`.quiet();
	} catch {
		// Ignore errors
	}
}

export async function gitAdd(workDir: string, files: string[]): Promise<void> {
	if (files.length === 0) return;
	try {
		await $`git -C ${workDir} add ${files}`.quiet();
	} catch {
		// Ignore errors
	}
}

export async function getHeadCommit(workDir: string): Promise<string | null> {
	try {
		const result = await $`git -C ${workDir} rev-parse HEAD`.text();
		return result.trim() || null;
	} catch {
		return null;
	}
}
