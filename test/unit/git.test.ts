import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { $ } from "bun";
import {
	ensureAutoresearchBranch,
	getCurrentBranch,
	getHeadCommit,
	getRepoRoot,
	gitClean,
	gitCommit,
	gitResetHard,
	gitRestoreFiles,
	isAutoresearchBranch,
} from "../../src/git";

async function initGitRepo(dir: string): Promise<void> {
	await $`git -C ${dir} init`;
	await $`git -C ${dir} config user.email "test@test.com"`;
	await $`git -C ${dir} config user.name "Test"`;
	// Create initial commit
	fs.writeFileSync(path.join(dir, "README.md"), "# Test");
	await $`git -C ${dir} add README.md`;
	await $`git -C ${dir} commit -m "Initial commit"`;
}

function createTempRepo(): { dir: string; cleanup: () => void } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-git-test-"));
	return {
		dir,
		cleanup: () => {
			fs.rmSync(dir, { recursive: true, force: true });
		},
	};
}

describe("git operations", () => {
	describe("getCurrentBranch", () => {
		it("returns branch name in git repo", async () => {
			const { dir, cleanup } = createTempRepo();
			await initGitRepo(dir);
			const branch = await getCurrentBranch(dir);
			expect(branch).toBe("main");
			cleanup();
		});

		it("returns null outside git repo", async () => {
			const { dir, cleanup } = createTempRepo();
			const branch = await getCurrentBranch(dir);
			expect(branch).toBeNull();
			cleanup();
		});
	});

	describe("isAutoresearchBranch", () => {
		it("returns true for autoresearch branch", () => {
			expect(isAutoresearchBranch("autoresearch/test")).toBe(true);
		});

		it("returns false for regular branch", () => {
			expect(isAutoresearchBranch("main")).toBe(false);
		});

		it("returns false for null", () => {
			expect(isAutoresearchBranch(null)).toBe(false);
		});
	});

	describe("ensureAutoresearchBranch", () => {
		it("returns existing branch when already on autoresearch branch", async () => {
			const { dir, cleanup } = createTempRepo();
			await initGitRepo(dir);
			await $`git -C ${dir} checkout -b autoresearch/test`;
			const result = await ensureAutoresearchBranch(dir, "Test goal");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.branchName).toBe("autoresearch/test");
				expect(result.created).toBe(false);
			}
			cleanup();
		});

		it("creates new branch on clean worktree", async () => {
			const { dir, cleanup } = createTempRepo();
			await initGitRepo(dir);
			const result = await ensureAutoresearchBranch(dir, "Test goal");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.created).toBe(true);
				expect(result.branchName).toStartWith("autoresearch/");
			}
			cleanup();
		});

		it("fails on dirty worktree", async () => {
			const { dir, cleanup } = createTempRepo();
			await initGitRepo(dir);
			fs.writeFileSync(path.join(dir, "dirty.txt"), "dirty");
			const result = await ensureAutoresearchBranch(dir, "Test goal");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain("dirty");
			}
			cleanup();
		});

		it("warns when not in git repo", async () => {
			const { dir, cleanup } = createTempRepo();
			const result = await ensureAutoresearchBranch(dir, "Test goal");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.warning).toContain("Not in a git repository");
			}
			cleanup();
		});
	});

	describe("getRepoRoot", () => {
		it("returns repo root", async () => {
			const { dir, cleanup } = createTempRepo();
			await initGitRepo(dir);
			const root = await getRepoRoot(dir);
			// On macOS, /var is a symlink to /private/var
			expect(root).toBeTruthy();
			expect(root?.replace("/private/var", "/var")).toBe(dir.replace("/private/var", "/var"));
			cleanup();
		});

		it("returns null outside repo", async () => {
			const { dir, cleanup } = createTempRepo();
			const root = await getRepoRoot(dir);
			expect(root).toBeNull();
			cleanup();
		});
	});

	describe("gitCommit", () => {
		it("commits files and returns hash", async () => {
			const { dir, cleanup } = createTempRepo();
			await initGitRepo(dir);
			await $`git -C ${dir} checkout -b autoresearch/test`;
			fs.writeFileSync(path.join(dir, "new.txt"), "content");
			const hash = await gitCommit(dir, "Test commit", ["new.txt"]);
			expect(hash).not.toBeNull();
			expect(hash?.length).toBe(40);
			cleanup();
		});

		it("returns null on failure", async () => {
			const { dir, cleanup } = createTempRepo();
			const hash = await gitCommit(dir, "Test", []);
			expect(hash).toBeNull();
			cleanup();
		});
	});

	describe("gitResetHard", () => {
		it("resets to HEAD", async () => {
			const { dir, cleanup } = createTempRepo();
			await initGitRepo(dir);
			await $`git -C ${dir} checkout -b autoresearch/test`;
			// Create, add, and commit a file, then modify it
			fs.writeFileSync(path.join(dir, "trackme.txt"), "original");
			await $`git -C ${dir} add trackme.txt`;
			await $`git -C ${dir} commit -m "Add trackme"`;
			// Modify the file
			fs.writeFileSync(path.join(dir, "trackme.txt"), "modified");
			await gitResetHard(dir);
			const content = fs.readFileSync(path.join(dir, "trackme.txt"), "utf-8");
			expect(content).toBe("original");
			cleanup();
		});
	});

	describe("gitClean", () => {
		it("removes untracked files", async () => {
			const { dir, cleanup } = createTempRepo();
			await initGitRepo(dir);
			fs.writeFileSync(path.join(dir, "untracked.txt"), "content");
			await gitClean(dir);
			expect(fs.existsSync(path.join(dir, "untracked.txt"))).toBe(false);
			cleanup();
		});
	});

	describe("gitRestoreFiles", () => {
		it("restores specific files", async () => {
			const { dir, cleanup } = createTempRepo();
			await initGitRepo(dir);
			fs.writeFileSync(path.join(dir, "README.md"), "modified");
			await gitRestoreFiles(dir, ["README.md"]);
			const content = fs.readFileSync(path.join(dir, "README.md"), "utf-8");
			expect(content).toBe("# Test");
			cleanup();
		});
	});

	describe("getHeadCommit", () => {
		it("returns HEAD hash", async () => {
			const { dir, cleanup } = createTempRepo();
			await initGitRepo(dir);
			const hash = await getHeadCommit(dir);
			expect(hash).not.toBeNull();
			expect(hash?.length).toBe(40);
			cleanup();
		});

		it("returns null outside repo", async () => {
			const { dir, cleanup } = createTempRepo();
			const hash = await getHeadCommit(dir);
			expect(hash).toBeNull();
			cleanup();
		});
	});
});
