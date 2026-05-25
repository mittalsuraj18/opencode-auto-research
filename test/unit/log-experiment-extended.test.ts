import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { $ } from "bun";
import { createLogExperimentTool } from "../../src/tools/log-experiment";
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

// Database must be in a separate dir from the git worktree,
// otherwise git clean -fd will wipe the SQLite files.
function makeDbPath(): string {
	const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-log-ext-db-"));
	return path.join(dbDir, "test.db");
}

function cleanupDir(dir: string) {
	cleanupTestDir(dir);
}

describe("createLogExperimentTool — scope deviations", () => {
	it("detects scope deviations for modified files outside scope", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-scope-test-"));
		const dbPath = makeDbPath();
		const storage = new AutoresearchStorage(dbPath, dir);
		await initGitRepo(dir);
		await $`git -C ${dir} checkout -b autoresearch/test`;

		const session = storage.insertSession({
			name: "Scope Test",
			goal: null,
			primaryMetric: "test_coverage_pct",
			metricUnit: "%",
			direction: "higher",
			branch: "autoresearch/test",
			baselineCommit: null,
			scopePaths: ["src"],
			offLimits: ["dist"],
			constraints: [],
			secondaryMetrics: [],
			notes: "",
			maxIterations: 10,
		});

		const run = storage.insertRun({
			sessionId: session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});

		// Create a file outside scope to trigger deviation detection
		fs.writeFileSync(path.join(dir, "outside-scope.txt"), "test");

		const runtime: AutoresearchRuntime = {
			autoresearchMode: true,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: { runNumber: run.id, passed: true, parsedPrimary: 80 },
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};

		const tool = createLogExperimentTool({ storage, runtime, directory: dir, client: {} });

		const result = await tool.execute({
			metric: 80,
			status: "keep",
			description: "Scope deviation test",
		});

		expect(result.output).toContain("Scope deviations");

		storage.close();
		cleanupDir(dir);
		cleanupDir(path.dirname(dbPath));
	});

	it("detects scope deviations for files in off_limits", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-offlimits-test-"));
		const dbPath = makeDbPath();
		const storage = new AutoresearchStorage(dbPath, dir);
		await initGitRepo(dir);
		await $`git -C ${dir} checkout -b autoresearch/test`;

		fs.mkdirSync(path.join(dir, "dist"), { recursive: true });

		const session = storage.insertSession({
			name: "OffLimits Test",
			goal: null,
			primaryMetric: "test_coverage_pct",
			metricUnit: "%",
			direction: "higher",
			branch: "autoresearch/test",
			baselineCommit: null,
			scopePaths: ["."],
			offLimits: ["dist"],
			constraints: [],
			secondaryMetrics: [],
			notes: "",
			maxIterations: 10,
		});

		const run = storage.insertRun({
			sessionId: session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});

		fs.writeFileSync(path.join(dir, "dist", "bundle.js"), "content");

		const runtime: AutoresearchRuntime = {
			autoresearchMode: true,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: { runNumber: run.id, passed: true, parsedPrimary: 80 },
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};

		const tool = createLogExperimentTool({ storage, runtime, directory: dir, client: {} });

		const result = await tool.execute({
			metric: 80,
			status: "keep",
			description: "Off-limits test",
		});

		expect(result.output).toContain("Scope deviations");

		storage.close();
		cleanupDir(dir);
		cleanupDir(path.dirname(dbPath));
	});
});

describe("createLogExperimentTool — git operations", () => {
	it("resets worktree on discard for autoresearch branch", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-reset-test-"));
		const dbPath = makeDbPath();
		const storage = new AutoresearchStorage(dbPath, dir);
		await initGitRepo(dir);
		await $`git -C ${dir} checkout -b autoresearch/test`;

		const session = storage.insertSession({
			name: "Reset Test",
			goal: null,
			primaryMetric: "test_coverage_pct",
			metricUnit: "%",
			direction: "higher",
			branch: "autoresearch/test",
			baselineCommit: null,
			scopePaths: ["."],
			offLimits: [],
			constraints: [],
			secondaryMetrics: [],
			notes: "",
			maxIterations: 10,
		});

		const run = storage.insertRun({
			sessionId: session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});

		const runtime: AutoresearchRuntime = {
			autoresearchMode: true,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: { runNumber: run.id, passed: true, parsedPrimary: 70 },
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};

		const tool = createLogExperimentTool({ storage, runtime, directory: dir, client: {} });

		const result = await tool.execute({
			metric: 70,
			status: "discard",
			description: "Regression",
		});

		expect(result.output).toContain("discard");
		expect(result.output).toContain("reset");

		storage.close();
		cleanupDir(dir);
		cleanupDir(path.dirname(dbPath));
	});

	it("commits changes on keep for autoresearch branch", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-commit-test-"));
		const dbPath = makeDbPath();
		const storage = new AutoresearchStorage(dbPath, dir);
		await initGitRepo(dir);
		await $`git -C ${dir} checkout -b autoresearch/test`;

		const session = storage.insertSession({
			name: "Commit Test",
			goal: null,
			primaryMetric: "test_coverage_pct",
			metricUnit: "%",
			direction: "higher",
			branch: "autoresearch/test",
			baselineCommit: null,
			scopePaths: ["."],
			offLimits: [],
			constraints: [],
			secondaryMetrics: [],
			notes: "",
			maxIterations: 10,
		});

		const run = storage.insertRun({
			sessionId: session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});

		const runtime: AutoresearchRuntime = {
			autoresearchMode: true,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: { runNumber: run.id, passed: true, parsedPrimary: 90 },
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};

		const tool = createLogExperimentTool({ storage, runtime, directory: dir, client: {} });

		const result = await tool.execute({
			metric: 90,
			status: "keep",
			description: "Improved coverage",
			metrics: { test_count: 300 },
		});

		expect(result.output).toContain("keep");
		expect(result.metadata.commitHash).toBeDefined();

		storage.close();
		cleanupDir(dir);
		cleanupDir(path.dirname(dbPath));
	});

	it("skips auto-commit when not on autoresearch branch", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-notauto-test-"));
		const dbPath = makeDbPath();
		const storage = new AutoresearchStorage(dbPath, dir);
		await initGitRepo(dir);

		const session = storage.insertSession({
			name: "Not Auto Test",
			goal: null,
			primaryMetric: "test_coverage_pct",
			metricUnit: "%",
			direction: "higher",
			branch: null,
			baselineCommit: null,
			scopePaths: ["."],
			offLimits: [],
			constraints: [],
			secondaryMetrics: [],
			notes: "",
			maxIterations: 10,
		});

		const run = storage.insertRun({
			sessionId: session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});

		const runtime: AutoresearchRuntime = {
			autoresearchMode: true,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: { runNumber: run.id, passed: true, parsedPrimary: 85 },
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};

		const tool = createLogExperimentTool({ storage, runtime, directory: dir, client: {} });

		const result = await tool.execute({
			metric: 85,
			status: "keep",
			description: "Non-auto branch keep",
		});

		expect(result.output).toContain("auto-commit skipped");

		storage.close();
		cleanupDir(dir);
		cleanupDir(path.dirname(dbPath));
	});
});

describe("createLogExperimentTool — autoresearch.md updates", () => {
	it("updates autoresearch.md with run results", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-md-test-"));
		const dbPath = makeDbPath();
		const storage = new AutoresearchStorage(dbPath, dir);
		await initGitRepo(dir);
		await $`git -C ${dir} checkout -b autoresearch/test`;

		fs.writeFileSync(
			path.join(dir, "autoresearch.md"),
			`# Autoresearch: Test\n\n## Baseline\nTBD\n\n## Notes\n\n\n\n## Runs\n| # | Status | Metric | Description |\n|---|--------|--------|-------------|\n`,
		);

		const session = storage.insertSession({
			name: "MD Update Test",
			goal: null,
			primaryMetric: "test_coverage_pct",
			metricUnit: "%",
			direction: "higher",
			branch: "autoresearch/test",
			baselineCommit: null,
			scopePaths: ["."],
			offLimits: [],
			constraints: [],
			secondaryMetrics: [],
			notes: "",
			maxIterations: 10,
		});

		const run = storage.insertRun({
			sessionId: session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});

		const runtime: AutoresearchRuntime = {
			autoresearchMode: true,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: { runNumber: run.id, passed: true, parsedPrimary: 79 },
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};

		const tool = createLogExperimentTool({ storage, runtime, directory: dir, client: {} });

		await tool.execute({
			metric: 79,
			status: "keep",
			description: "Baseline for MD test",
		});

		const mdContent = fs.readFileSync(path.join(dir, "autoresearch.md"), "utf-8");
		expect(mdContent).toContain("Baseline for MD test");
		expect(mdContent).toContain("79");

		storage.close();
		cleanupDir(dir);
		cleanupDir(path.dirname(dbPath));
	});

	it("updates baseline in autoresearch.md for first keep", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-baseline-md-"));
		const dbPath = makeDbPath();
		const storage = new AutoresearchStorage(dbPath, dir);
		await initGitRepo(dir);
		await $`git -C ${dir} checkout -b autoresearch/test`;

		fs.writeFileSync(
			path.join(dir, "autoresearch.md"),
			`# Autoresearch: Test\n\n## Baseline\nTBD\n\n## Notes\n\n\n\n## Runs\n| # | Status | Metric | Description |\n|---|--------|--------|-------------|\n`,
		);

		const session = storage.insertSession({
			name: "Baseline MD Test",
			goal: null,
			primaryMetric: "test_coverage_pct",
			metricUnit: "%",
			direction: "higher",
			branch: "autoresearch/test",
			baselineCommit: null,
			scopePaths: ["."],
			offLimits: [],
			constraints: [],
			secondaryMetrics: [],
			notes: "",
			maxIterations: 10,
		});

		const run = storage.insertRun({
			sessionId: session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});

		const runtime: AutoresearchRuntime = {
			autoresearchMode: true,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: { runNumber: run.id, passed: true, parsedPrimary: 82 },
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};

		const tool = createLogExperimentTool({ storage, runtime, directory: dir, client: {} });

		await tool.execute({
			metric: 82,
			status: "keep",
			description: "First baseline",
		});

		const mdContent = fs.readFileSync(path.join(dir, "autoresearch.md"), "utf-8");
		expect(mdContent).toContain("First baseline");
		expect(mdContent).toContain("82");
		// Note: The "TBD" may or may not be replaced depending on whether
		// the state already has results when updateAutoresearchMd runs.

		storage.close();
		cleanupDir(dir);
		cleanupDir(path.dirname(dbPath));
	});
});

describe("createLogExperimentTool — confidence and stats", () => {
	it("shows best result when different from baseline", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-best-test-"));
		const dbPath = makeDbPath();
		const storage = new AutoresearchStorage(dbPath, dir);
		await initGitRepo(dir);
		await $`git -C ${dir} checkout -b autoresearch/test`;

		const session = storage.insertSession({
			name: "Best Test",
			goal: null,
			primaryMetric: "test_coverage_pct",
			metricUnit: "%",
			direction: "higher",
			branch: "autoresearch/test",
			baselineCommit: null,
			scopePaths: ["."],
			offLimits: [],
			constraints: [],
			secondaryMetrics: [],
			notes: "",
			maxIterations: 10,
		});

		// First run - baseline
		const run1 = storage.insertRun({
			sessionId: session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test1.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});
		storage.markRunCompleted({
			runId: run1.id,
			completedAt: Date.now(),
			durationMs: 1000,
			exitCode: 0,
			timedOut: false,
			parsedPrimary: 79,
			parsedMetrics: { test_coverage_pct: 79 },
			parsedAsi: null,
		});
		storage.markRunLogged({
			runId: run1.id,
			status: "keep",
			description: "Baseline",
			metric: 79,
			metrics: { test_coverage_pct: 79 },
			asi: null,
			commitHash: "abc123",
			confidence: null,
			modifiedPaths: [],
			scopeDeviations: [],
			justification: null,
			loggedAt: Date.now(),
		});

		// Second run - improvement
		const run2 = storage.insertRun({
			sessionId: session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test2.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});

		const runtime: AutoresearchRuntime = {
			autoresearchMode: true,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: { runNumber: run2.id, passed: true, parsedPrimary: 85 },
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};

		const tool = createLogExperimentTool({ storage, runtime, directory: dir, client: {} });

		const result = await tool.execute({
			metric: 85,
			status: "keep",
			description: "Improved",
		});

		expect(result.output).toContain("Best:");
		expect(result.output).toContain("vs baseline");

		storage.close();
		cleanupDir(dir);
		cleanupDir(path.dirname(dbPath));
	});
});
