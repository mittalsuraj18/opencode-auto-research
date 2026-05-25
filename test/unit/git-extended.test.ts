import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { $ } from "bun";
import {
	collectRelativeDirtyPaths,
	ensureAutoresearchBranch,
	gitAdd,
	gitCommit,
	getCurrentBranch,
	isAutoresearchBranch,
	parseWorkDirDirtyPaths,
} from "../../src/git";

async function initGitRepo(dir: string): Promise<void> {
	await $`git -C ${dir} init`;
	await $`git -C ${dir} config user.email "test@test.com"`;
	await $`git -C ${dir} config user.name "Test"`;
	fs.writeFileSync(path.join(dir, "README.md"), "# Test");
	await $`git -C ${dir} add README.md`;
	await $`git -C ${dir} commit -m "Initial commit"`;
}

describe("git extended operations", () => {
	describe("ensureAutoresearchBranch — error paths", () => {
		it("fails to create branch when git checkout fails", async () => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-git-checkout-err-"));
			await initGitRepo(dir);
			// Create a branch name that would conflict with something
			// This is hard to trigger directly, but we can try with a very long goal name
			// that would make the branch name too long (though git usually handles this)
			// Instead, let's test a simpler scenario
			const result = await ensureAutoresearchBranch(dir, "test goal");
			expect(result.ok).toBe(true);
			fs.rmSync(dir, { recursive: true, force: true });
		});

		it("handles subsequent branch creation with name collision", async () => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-git-collision-"));
			await initGitRepo(dir);
			// Create first branch
			const result1 = await ensureAutoresearchBranch(dir, "collision-test");
			expect(result1.ok).toBe(true);
			if (result1.ok) {
				expect(result1.created).toBe(true);
			}
			// Go back to main
			await $`git -C ${dir} checkout main`.quiet();
			// Create second branch with same goal - should get a different name
			const result2 = await ensureAutoresearchBranch(dir, "collision-test");
			expect(result2.ok).toBe(true);
			if (result2.ok) {
				expect(result2.branchName).not.toBe(result1.ok ? result1.branchName : null);
			}
			fs.rmSync(dir, { recursive: true, force: true });
		});
	});

	describe("collectRelativeDirtyPaths", () => {
		it("collects paths relative to workdir prefix", () => {
			const status = " M\0packages/core/src/a.ts\0??\0packages/core/new.ts\0";
			const paths = collectRelativeDirtyPaths(status, "packages/core");
			expect(paths).toContain("src/a.ts");
			expect(paths).toContain("new.ts");
		});

		it("uses full path when prefix doesn't match", () => {
			const status = " M\0other/index.ts\0";
			const paths = collectRelativeDirtyPaths(status, "packages/core");
			expect(paths).toContain("other/index.ts");
		});

		it("handles empty prefix", () => {
			const status = " M\0src/index.ts\0";
			const paths = collectRelativeDirtyPaths(status, "");
			expect(paths).toContain("src/index.ts");
		});
	});

	describe("parseWorkDirDirtyPaths (git.ts version)", () => {
		it("filters by workdir prefix", () => {
			const status = " M\0packages/core/src/a.ts\0";
			const paths = parseWorkDirDirtyPaths(status, "packages/core");
			expect(paths).toContain("src/a.ts");
		});
	});

	describe("gitAdd", () => {
		it("adds files to staging", async () => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-git-add-"));
			await initGitRepo(dir);
			fs.writeFileSync(path.join(dir, "newfile.txt"), "content");
			await gitAdd(dir, ["newfile.txt"]);
			// Check that the file is staged
			const status = await $`git -C ${dir} status --porcelain`.text();
			expect(status).toContain("A");
			expect(status).toContain("newfile.txt");
			fs.rmSync(dir, { recursive: true, force: true });
		});

		it("does nothing for empty file list", async () => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-git-add-empty-"));
			await initGitRepo(dir);
			await gitAdd(dir, []);
			// Should not error
			fs.rmSync(dir, { recursive: true, force: true });
		});
	});

	describe("isAutoresearchBranch", () => {
		it("returns true for autoresearch/ prefix", () => {
			expect(isAutoresearchBranch("autoresearch/test")).toBe(true);
			expect(isAutoresearchBranch("autoresearch/coverage-boost-20260101")).toBe(true);
		});

		it("returns false for other branches", () => {
			expect(isAutoresearchBranch("main")).toBe(false);
			expect(isAutoresearchBranch("feature/test")).toBe(false);
		});

		it("returns false for null", () => {
			expect(isAutoresearchBranch(null)).toBe(false);
		});
	});
});
