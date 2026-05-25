import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { $ } from "bun";
import { createInitExperimentTool } from "../../src/tools/init-experiment";
import { AutoresearchStorage } from "../../src/storage";
import { createExperimentState } from "../../src/state";
import type { AutoresearchRuntime } from "../../src/types";
import { cleanupTestDir } from "../test-helpers";

async function initGitRepo(dir: string): Promise<void> {
	await $`git -C ${dir} init`;
	await $`git -C ${dir} config user.email "test@test.com"`;
	await $`git -C ${dir} config user.name "Test"`;
	fs.writeFileSync(path.join(dir, "README.md"), "# Test");
	await $`git -C ${dir} add README.md`;
	await $`git -C ${dir} commit -m "Initial commit"`;
}

async function commitAll(dir: string): Promise<void> {
	await $`git -C ${dir} add -A`;
	await $`git -C ${dir} commit -m "Pre-init commit"`;
}

describe("createInitExperimentTool", () => {
	it("initializes experiment with all parameters", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-init-test-"));
		const dbPath = path.join(dir, "test.db");
		const storage = new AutoresearchStorage(dbPath, dir);

		fs.writeFileSync(path.join(dir, "autoresearch.sh"), '#!/bin/bash\necho "METRIC x=1"');
		fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);
		await initGitRepo(dir);
		await commitAll(dir);

		const runtime: AutoresearchRuntime = {
			autoresearchMode: false,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: null,
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};
		const tool = createInitExperimentTool({ storage, runtime, directory: dir });

		const result = await tool.execute({
			name: "Coverage Boost",
			goal: "Reach 95% coverage",
			primary_metric: "test_coverage_pct",
			metric_unit: "%",
			direction: "higher",
			scope_paths: ["src"],
			off_limits: ["dist"],
			max_iterations: 10,
		});

		expect(result.title).toBe("init_experiment");
		expect(result.output).toContain("Coverage Boost");
		expect(result.output).toContain("test_coverage_pct");
		expect(runtime.autoresearchMode).toBe(true);
		expect(runtime.state.scopePaths).toEqual(["src"]);
		expect(runtime.state.offLimits).toEqual(["dist"]);

		storage.close();
		cleanupTestDir(dir);
	});

	it("initializes with lower direction", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-init-lower-"));
		const dbPath = path.join(dir, "test.db");
		const storage = new AutoresearchStorage(dbPath, dir);

		fs.writeFileSync(path.join(dir, "autoresearch.sh"), '#!/bin/bash\necho "METRIC x=1"');
		fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);
		await initGitRepo(dir);
		await commitAll(dir);

		const runtime: AutoresearchRuntime = {
			autoresearchMode: false,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: null,
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};
		const tool = createInitExperimentTool({ storage, runtime, directory: dir });

		const result = await tool.execute({
			name: "Speed Test",
			primary_metric: "compile_time_ms",
			direction: "lower",
		});

		expect(result.output).toContain("lower is better");

		storage.close();
		cleanupTestDir(dir);
	});

	it("creates autoresearch.md file", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-init-md-"));
		const dbPath = path.join(dir, "test.db");
		const storage = new AutoresearchStorage(dbPath, dir);

		fs.writeFileSync(path.join(dir, "autoresearch.sh"), '#!/bin/bash\necho "METRIC x=1"');
		fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);
		await initGitRepo(dir);
		await commitAll(dir);

		const runtime: AutoresearchRuntime = {
			autoresearchMode: false,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: null,
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};
		const tool = createInitExperimentTool({ storage, runtime, directory: dir });

		await tool.execute({
			name: "MD Test",
			goal: "Create MD",
			primary_metric: "test_coverage_pct",
			direction: "higher",
		});

		const mdPath = path.join(dir, "autoresearch.md");
		expect(fs.existsSync(mdPath)).toBe(true);
		const content = fs.readFileSync(mdPath, "utf-8");
		expect(content).toContain("MD Test");
		expect(content).toContain("Create MD");
		expect(content).toContain("test_coverage_pct");

		storage.close();
		cleanupTestDir(dir);
	});

	it("does not overwrite existing autoresearch.md", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-init-nooverwrite-"));
		const dbPath = path.join(dir, "test.db");
		const storage = new AutoresearchStorage(dbPath, dir);

		fs.writeFileSync(path.join(dir, "autoresearch.sh"), '#!/bin/bash\necho "METRIC x=1"');
		fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);
		fs.writeFileSync(path.join(dir, "autoresearch.md"), "Existing content");
		await initGitRepo(dir);
		await commitAll(dir);

		const runtime: AutoresearchRuntime = {
			autoresearchMode: false,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: null,
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};
		const tool = createInitExperimentTool({ storage, runtime, directory: dir });

		await tool.execute({
			name: "Existing MD Test",
			primary_metric: "test_coverage_pct",
			direction: "higher",
		});

		expect(fs.existsSync(path.join(dir, "autoresearch.md"))).toBe(true);

		storage.close();
		cleanupTestDir(dir);
	});

	it("warns when autoresearch.sh is missing", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-no-sh-"));
		const dbPath = path.join(dir, "test.db");
		const storage = new AutoresearchStorage(dbPath, dir);
		await initGitRepo(dir);
		await commitAll(dir);

		const runtime: AutoresearchRuntime = {
			autoresearchMode: false,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: null,
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};
		const tool = createInitExperimentTool({ storage, runtime, directory: dir });

		const result = await tool.execute({
			name: "Missing Harness",
			primary_metric: "test_coverage_pct",
			direction: "higher",
		});

		expect(result.output).toContain("autoresearch.sh not found");

		storage.close();
		cleanupTestDir(dir);
	});

	it("deduplicates scope_paths and off_limits", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-init-dedupe-"));
		const dbPath = path.join(dir, "test.db");
		const storage = new AutoresearchStorage(dbPath, dir);

		fs.writeFileSync(path.join(dir, "autoresearch.sh"), '#!/bin/bash\necho "METRIC x=1"');
		fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);
		await initGitRepo(dir);
		await commitAll(dir);

		const runtime: AutoresearchRuntime = {
			autoresearchMode: false,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: null,
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};
		const tool = createInitExperimentTool({ storage, runtime, directory: dir });

		const result = await tool.execute({
			name: "Dedupe Test",
			primary_metric: "test_coverage_pct",
			direction: "higher",
			scope_paths: ["src", "src", "test"],
			off_limits: ["dist", "dist"],
		});

		expect(result.output).toContain("Dedupe Test");
		expect(runtime.state.scopePaths).toEqual(["src", "test"]);

		storage.close();
		cleanupTestDir(dir);
	});

	it("sets runtime state correctly", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-init-state-"));
		const dbPath = path.join(dir, "test.db");
		const storage = new AutoresearchStorage(dbPath, dir);

		fs.writeFileSync(path.join(dir, "autoresearch.sh"), '#!/bin/bash\necho "METRIC x=1"');
		fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);
		await initGitRepo(dir);
		await commitAll(dir);

		const runtime: AutoresearchRuntime = {
			autoresearchMode: false,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: null,
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};
		const tool = createInitExperimentTool({ storage, runtime, directory: dir });

		await tool.execute({
			name: "State Test",
			goal: "Check state",
			primary_metric: "test_coverage_pct",
			metric_unit: "%",
			direction: "higher",
			scope_paths: ["src"],
			off_limits: ["dist"],
			max_iterations: 5,
		});

		expect(runtime.state.name).toBe("State Test");
		expect(runtime.state.goal).toBe("Check state");
		expect(runtime.state.metricName).toBe("test_coverage_pct");
		expect(runtime.state.bestDirection).toBe("higher");
		expect(runtime.state.scopePaths).toEqual(["src"]);
		expect(runtime.state.offLimits).toEqual(["dist"]);
		expect(runtime.state.maxExperiments).toBe(5);

		storage.close();
		cleanupTestDir(dir);
	});

	it("handles no goal provided", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-init-nogoal-"));
		const dbPath = path.join(dir, "test.db");
		const storage = new AutoresearchStorage(dbPath, dir);

		fs.writeFileSync(path.join(dir, "autoresearch.sh"), '#!/bin/bash\necho "METRIC x=1"');
		fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);
		await initGitRepo(dir);
		await commitAll(dir);

		const runtime: AutoresearchRuntime = {
			autoresearchMode: false,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: null,
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};
		const tool = createInitExperimentTool({ storage, runtime, directory: dir });

		const result = await tool.execute({
			name: "No Goal",
			primary_metric: "test_coverage_pct",
			direction: "lower",
		});

		expect(result.output).toContain("No Goal");
		expect(runtime.goal).toBeNull();

		storage.close();
		cleanupTestDir(dir);
	});

	it("returns metadata with session info", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-init-meta-"));
		const dbPath = path.join(dir, "test.db");
		const storage = new AutoresearchStorage(dbPath, dir);

		fs.writeFileSync(path.join(dir, "autoresearch.sh"), '#!/bin/bash\necho "METRIC x=1"');
		fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);
		await initGitRepo(dir);
		await commitAll(dir);

		const runtime: AutoresearchRuntime = {
			autoresearchMode: false,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: null,
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};
		const tool = createInitExperimentTool({ storage, runtime, directory: dir });

		const result = await tool.execute({
			name: "Metadata Test",
			primary_metric: "test_coverage_pct",
			direction: "higher",
		});

		expect(result.metadata.sessionId).toBeDefined();
		expect(result.metadata.sessionId).toBeGreaterThan(0);
		expect(result.metadata.harnessExists).toBe(true);

		storage.close();
		cleanupTestDir(dir);
	});

	it("returns error when branch creation fails (dirty worktree)", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-init-dirty-"));
		const dbPath = path.join(dir, "test.db");
		const storage = new AutoresearchStorage(dbPath, dir);
		await initGitRepo(dir);
		// Create dirty file
		fs.writeFileSync(path.join(dir, "dirty.txt"), "dirty");

		const runtime: AutoresearchRuntime = {
			autoresearchMode: false,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: null,
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};
		const tool = createInitExperimentTool({ storage, runtime, directory: dir });

		const result = await tool.execute({
			name: "Dirty Test",
			primary_metric: "test_coverage_pct",
			direction: "higher",
		});

		expect(result.metadata.error).toBeDefined();
		expect(result.output).toContain("Failed to initialize");

		storage.close();
		cleanupTestDir(dir);
	});
});
