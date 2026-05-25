import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createRunExperimentTool } from "../../src/tools/run-experiment";
import { AutoresearchStorage } from "../../src/storage";
import { createExperimentState } from "../../src/state";
import type { AutoresearchRuntime } from "../../src/types";
import { cleanupTestDir } from "../test-helpers";

function createTestEnv() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-run-exp-test-"));
	const dbPath = path.join(dir, "test.db");
	const storage = new AutoresearchStorage(dbPath, dir);

	// Create autoresearch.sh harness
	fs.writeFileSync(
		path.join(dir, "autoresearch.sh"),
		'#!/bin/bash\necho "METRIC test_coverage_pct=85"\necho "METRIC test_count=200"\necho "ASI hypothesis=test more"\nexit 0',
	);
	fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);

	const session = storage.insertSession({
		name: "Test",
		goal: "Improve coverage",
		primaryMetric: "test_coverage_pct",
		metricUnit: "%",
		direction: "higher",
		branch: null,
		baselineCommit: null,
		scopePaths: [],
		offLimits: [],
		constraints: [],
		secondaryMetrics: [],
		notes: "",
		maxIterations: 10,
	});

	const runtime: AutoresearchRuntime = {
		autoresearchMode: true,
		goal: "Improve coverage",
		state: createExperimentState(),
		runningExperiment: null,
		lastRunSummary: null,
		lastAutoResumePendingRunNumber: null,
		justLoggedExperiment: false,
		needsCompaction: false,
		currentModel: null,
	};

	const tool = createRunExperimentTool({ storage, runtime, directory: dir });

	return {
		dir,
		storage,
		session,
		runtime,
		tool,
		cleanup: () => {
			storage.close();
			cleanupTestDir(dir);
		},
	};
}

describe("createRunExperimentTool", () => {
	it("returns error when autoresearch.sh is missing", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-no-harness-"));
		const dbPath = path.join(dir, "test.db");
		const storage = new AutoresearchStorage(dbPath, dir);
		const runtime: AutoresearchRuntime = {
			autoresearchMode: true,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: null,
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};
		storage.insertSession({
			name: "Test",
			goal: null,
			primaryMetric: "test_coverage_pct",
			metricUnit: "%",
			direction: "higher",
			branch: null,
			baselineCommit: null,
			scopePaths: [],
			offLimits: [],
			constraints: [],
			secondaryMetrics: [],
			notes: "",
			maxIterations: null,
		});
		const tool = createRunExperimentTool({ storage, runtime, directory: dir });
		const result = await tool.execute({});
		expect(result.metadata.error).toBe("harness_missing");
		storage.close();
		cleanupTestDir(dir);
	});

	it("returns error when no active session", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-no-session-run-"));
		const dbPath = path.join(dir, "test.db");
		const storage = new AutoresearchStorage(dbPath, dir);
		fs.writeFileSync(
			path.join(dir, "autoresearch.sh"),
			'#!/bin/bash\necho "METRIC test_coverage_pct=85"',
		);
		fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);
		const runtime: AutoresearchRuntime = {
			autoresearchMode: true,
			goal: null,
			state: createExperimentState(),
			runningExperiment: null,
			lastRunSummary: null,
			lastAutoResumePendingRunNumber: null,
			justLoggedExperiment: false,
			needsCompaction: false,
			currentModel: null,
		};
		const tool = createRunExperimentTool({ storage, runtime, directory: dir });
		const result = await tool.execute({});
		expect(result.metadata.error).toBe("no_session");
		storage.close();
		cleanupTestDir(dir);
	});

	it("warns when a pending run exists", async () => {
		const env = createTestEnv();
		env.runtime.lastRunSummary = { runNumber: 1, passed: true, parsedPrimary: 80 };
		env.runtime.justLoggedExperiment = false;

		const result = await env.tool.execute({});
		expect(result.output).toContain("pending");
		expect(result.metadata.pendingRun).toBe(1);

		env.cleanup();
	});

	it("executes benchmark and parses metrics", async () => {
		const env = createTestEnv();
		const result = await env.tool.execute({ timeout_seconds: 120 });

		expect(result.title).toBe("run_experiment");
		expect(result.metadata.primaryMetric).toBe(85);
		expect(result.metadata.metrics.test_coverage_pct).toBe(85);
		expect(result.metadata.metrics.test_count).toBe(200);

		env.cleanup();
	});

	it("parses ASI data from benchmark output", async () => {
		const env = createTestEnv();
		const result = await env.tool.execute({ timeout_seconds: 120 });

		expect(result.metadata.asi).toBeDefined();
		expect(result.metadata.asi.hypothesis).toBe("test more");

		env.cleanup();
	});

	it("creates run record in storage", async () => {
		const env = createTestEnv();
		await env.tool.execute({ timeout_seconds: 120 });

		const runs = env.storage.getRunsForSession(env.session.id);
		expect(runs.length).toBe(1);
		expect(runs[0].parsed_primary).toBe(85);

		env.cleanup();
	});

	it("sets runtime.lastRunSummary after completion", async () => {
		const env = createTestEnv();
		await env.tool.execute({ timeout_seconds: 120 });

		expect(env.runtime.lastRunSummary).not.toBeNull();
		expect(env.runtime.lastRunSummary?.runNumber).toBeGreaterThan(0);
		expect(env.runtime.lastRunSummary?.parsedPrimary).toBe(85);

		env.cleanup();
	});

	it("clears runningExperiment after completion", async () => {
		const env = createTestEnv();
		await env.tool.execute({ timeout_seconds: 120 });
		expect(env.runtime.runningExperiment).toBeNull();

		env.cleanup();
	});

	it("saves output to log file", async () => {
		const env = createTestEnv();
		const result = await env.tool.execute({ timeout_seconds: 120 });
		const logPath = result.metadata.logPath;
		expect(fs.existsSync(logPath)).toBe(true);
		const content = fs.readFileSync(logPath, "utf-8");
		expect(content).toContain("METRIC");

		env.cleanup();
	});

	it("resets justLoggedExperiment on new run", async () => {
		const env = createTestEnv();
		env.runtime.justLoggedExperiment = true;
		await env.tool.execute({ timeout_seconds: 120 });
		expect(env.runtime.justLoggedExperiment).toBe(false);

		env.cleanup();
	});

	it("includes metric info in result output", async () => {
		const env = createTestEnv();
		const result = await env.tool.execute({ timeout_seconds: 120 });
		expect(result.output).toContain("test_coverage_pct = 85");
		expect(result.output).toContain("test_count=200");

		env.cleanup();
	});

	it("handles benchmark failure gracefully", async () => {
		const env = createTestEnv();
		// Replace harness with one that fails
		fs.writeFileSync(
			path.join(env.dir, "autoresearch.sh"),
			'#!/bin/bash\necho "Error occurred" >&2\nexit 1',
		);

		const result = await env.tool.execute({ timeout_seconds: 120 });
		// Should still return a result (not crash)
		expect(result.title).toBe("run_experiment");
		expect(result.metadata).toBeDefined();

		env.cleanup();
	});
});
