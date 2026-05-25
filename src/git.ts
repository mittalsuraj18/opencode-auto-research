/**
 * @file git.ts
 * @description Implements Git branch allocation, checkout, commit, reset, and dirty path operations.
 * Provides utilities for managing autoresearch-specific git workflows.
 */

import { $ } from "bun";
import {
	normalizePathSpec,
	normalizeStatusPath,
	parseDirtyPaths,
	relativizeGitPathToWorkDir,
} from "./helpers";

const AUTORESEARCH_BRANCH_PREFIX = "autoresearch/";
const BRANCH_NAME_MAX_LENGTH = 48;

/** Result when autoresearch branch setup fails */
export interface EnsureAutoresearchBranchFailure {
	error: string;
	ok: false;
}

/** Result when autoresearch branch setup succeeds */
export interface EnsureAutoresearchBranchSuccess {
	branchName: string | null;
	created: boolean;
	ok: true;
	warning?: string;
}

/** Union type for branch setup results */
export type EnsureAutoresearchBranchResult =
	| EnsureAutoresearchBranchFailure
	| EnsureAutoresearchBranchSuccess;

/**
 * Retrieves the current git branch name for the given working directory.
 * @param workDir - Path to the git working directory
 * @returns The current branch name, or null if not in a git repository
 */
export async function getCurrentBranch(workDir: string): Promise<string | null> {
	try {
		const result = await $`git -C ${workDir} rev-parse --abbrev-ref HEAD`.text();
		return result.trim() || null;
	} catch {
		return null;
	}
}

/**
 * Checks whether a branch name belongs to an autoresearch branch.
 * @param branch - Branch name to check
 * @returns True if the branch starts with the autoresearch prefix
 */
export function isAutoresearchBranch(branch: string | null): boolean {
	return branch !== null && branch.startsWith(AUTORESEARCH_BRANCH_PREFIX);
}

/**
 * Ensures the repository is on an autoresearch branch, creating one if necessary.
 * Validates that the worktree is clean before switching branches.
 * @param workDir - Path to the git working directory
 * @param goal - Experiment goal used to generate the branch name
 * @returns Result indicating success or failure with details
 */
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

/**
 * Resolves the root directory of the git repository containing the working directory.
 * @param workDir - Path to the git working directory
 * @returns Absolute path to the repository root, or null if not in a git repository
 */
export async function getRepoRoot(workDir: string): Promise<string | null> {
	try {
		const result = await $`git -C ${workDir} rev-parse --show-toplevel`.text();
		return result.trim() || null;
	} catch {
		return null;
	}
}

/**
 * Reads the git work directory prefix relative to the repository root.
 * @param workDir - Path to the git working directory
 * @returns Normalized prefix string
 */
async function readGitWorkDirPrefix(workDir: string): Promise<string> {
	try {
		const result = await $`git -C ${workDir} rev-parse --show-prefix`.text();
		return normalizePathSpec(result);
	} catch {
		return "";
	}
}

/**
 * Parses git status output and converts dirty paths to be relative to the work directory.
 * @param statusOutput - Raw git status output
 * @param workDirPrefix - Prefix for the current working directory within the repo
 * @returns Array of relative dirty paths
 */
export function parseWorkDirDirtyPaths(statusOutput: string, workDirPrefix: string): string[] {
	const relativePaths: string[] = [];
	for (const dirtyPath of parseDirtyPaths(statusOutput)) {
		const relativePath = relativizeGitPathToWorkDir(dirtyPath, workDirPrefix);
		if (relativePath === null) continue;
		relativePaths.push(relativePath);
	}
	return relativePaths;
}

/**
 * Collects all relative dirty paths from git status, falling back to normalized paths.
 * @param statusOutput - Raw git status output
 * @param workDirPrefix - Prefix for the current working directory within the repo
 * @returns Array of dirty paths relative to the work directory
 */
export function collectRelativeDirtyPaths(statusOutput: string, workDirPrefix: string): string[] {
	const dirtyPaths: string[] = [];
	for (const dirtyPath of parseDirtyPaths(statusOutput)) {
		const relativePath = relativizeGitPathToWorkDir(dirtyPath, workDirPrefix);
		dirtyPaths.push(relativePath ?? normalizeStatusPath(dirtyPath));
	}
	return dirtyPaths;
}

/**
 * Formats a list of dirty paths for display, truncating if there are more than 5.
 * @param paths - Array of dirty path strings
 * @returns Formatted preview string
 */
function formatDirtyPaths(paths: string[]): string {
	const preview = paths.slice(0, 5).join(", ");
	return paths.length > 5 ? `${preview} (+${paths.length - 5} more)` : preview;
}

/**
 * Allocates a unique autoresearch branch name based on the experiment goal and date.
 * @param workDir - Path to the git working directory
 * @param goal - Experiment goal used for the branch name slug
 * @returns Unique branch name string
 */
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

/**
 * Checks whether a branch already exists in the repository.
 * @param workDir - Path to the git working directory
 * @param branchName - Branch name to check
 * @returns True if the branch exists
 */
async function branchExists(workDir: string, branchName: string): Promise<boolean> {
	try {
		await $`git -C ${workDir} show-ref --verify --quiet refs/heads/${branchName}`;
		return true;
	} catch {
		return false;
	}
}

/**
 * Converts a goal string into a URL-safe slug for branch naming.
 * @param goal - Raw experiment goal string
 * @returns Normalized slug suitable for git branch names
 */
function slugifyGoal(goal: string | null): string {
	const normalized = (goal ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const trimmed = normalized.slice(0, BRANCH_NAME_MAX_LENGTH).replace(/-+$/g, "");
	return trimmed || "session";
}

/**
 * Generates a YYYYMMDD date stamp for branch naming.
 * @returns Date string in YYYYMMDD format
 */
function currentDateStamp(): string {
	const now = new Date();
	const year = String(now.getFullYear());
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}${month}${day}`;
}

/**
 * Commits files in the working directory with the given message.
 * @param workDir - Path to the git working directory
 * @param message - Commit message
 * @param files - Specific files to stage; if empty, stages all changes
 * @returns Commit hash string, or null on failure
 */
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

/**
 * Resets the working directory to HEAD, discarding all uncommitted changes.
 * @param workDir - Path to the git working directory
 */
export async function gitResetHard(workDir: string): Promise<void> {
	try {
		await $`git -C ${workDir} reset --hard HEAD`.quiet();
	} catch {
		// Ignore errors
	}
}

/**
 * Removes untracked files and directories from the working tree.
 * @param workDir - Path to the git working directory
 */
export async function gitClean(workDir: string): Promise<void> {
	try {
		await $`git -C ${workDir} clean -fd`.quiet();
	} catch {
		// Ignore errors
	}
}

/**
 * Restores specified files to their HEAD state in both index and worktree.
 * @param workDir - Path to the git working directory
 * @param files - Array of file paths to restore
 */
export async function gitRestoreFiles(workDir: string, files: string[]): Promise<void> {
	if (files.length === 0) return;
	try {
		await $`git -C ${workDir} restore --source=HEAD --staged --worktree ${files}`.quiet();
	} catch {
		// Ignore errors
	}
}

/**
 * Stages the specified files for commit.
 * @param workDir - Path to the git working directory
 * @param files - Array of file paths to stage
 */
export async function gitAdd(workDir: string, files: string[]): Promise<void> {
	if (files.length === 0) return;
	try {
		await $`git -C ${workDir} add ${files}`.quiet();
	} catch {
		// Ignore errors
	}
}

/**
 * Retrieves the HEAD commit hash for the current branch.
 * @param workDir - Path to the git working directory
 * @returns Commit hash string, or null on failure
 */
export async function getHeadCommit(workDir: string): Promise<string | null> {
	try {
		const result = await $`git -C ${workDir} rev-parse HEAD`.text();
		return result.trim() || null;
	} catch {
		return null;
	}
}
