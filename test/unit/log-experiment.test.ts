import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createLogExperimentTool } from "../../src/tools/log-experiment";
import { AutoresearchStorage } from "../../src/storage";
import { createExperimentState } from "../../src/state";
import type { AutoresearchRuntime, PendingRunSummary } from "../../src/types";
import { cleanupTestDir } from "../test-helpers";

function createTestEnv() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-log-exp-test-"));
	const dbPath = path.join(dir, "test.db");
	const storage = new AutoresearchStorage(dbPath, dir);

	const session = storage.insertSession({
		name: "Test",
		goal: "Optimize coverage",
		primaryMetric: "test_coverage_pct",
		metricUnit: "%",
		direction: "higher",
		branch: null,
		baselineCommit: null,
		scopePaths: ["src"],
		offLimits: ["dist"],
		constraints: [],
		secondaryMetrics: [],
		notes: "",
		maxIterations: 10,
	});

	const runtime: AutoresearchRuntime = {
		autoresearchMode: true,
		goal: "Optimize coverage",
		state: createExperimentState(),
		runningExperiment: null,
		lastRunSummary: null,
		lastAutoResumePendingRunNumber: null,
		justLoggedExperiment: false,
		needsCompaction: false,
		currentModel: null,
	};

	const mockClient = {};

	const tool = createLogExperimentTool({ storage, runtime, directory: dir, client: mockClient });

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

describe("createLogExperimentTool", () => {
	it("returns error when no active session", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-no-session-log-"));
		const dbPath = path.join(dir, "empty.db");
		const storage = new AutoresearchStorage(dbPath, dir);
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
		const tool = createLogExperimentTool({ storage, runtime, directory: dir, client: {} });
		const result = await tool.execute({ metric: 80, status: "keep", description: "Test" });
		expect(result.metadata.error).toBe("no_session");
		storage.close();
		cleanupTestDir(dir);
	});

	it("returns error when no pending run", async () => {
		const env = createTestEnv();
		const result = await env.tool.execute({ metric: 80, status: "keep", description: "Test" });
		expect(result.metadata.error).toBe("no_pending_run");
		env.cleanup();
	});

	it("returns error when run not found in storage", async () => {
		const env = createTestEnv();
		// Set a lastRunSummary with a run ID that doesn't exist in storage
		env.runtime.lastRunSummary = { runNumber: 9999, passed: true, parsedPrimary: 80 };
		const result = await env.tool.execute({ metric: 80, status: "keep", description: "Test" });
		expect(result.metadata.error).toBe("run_not_found");
		env.cleanup();
	});

	it("logs a keep run successfully", async () => {
		const env = createTestEnv();

		// Insert a run into storage and set it as the pending run
		const run = env.storage.insertRun({
			sessionId: env.session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});
		env.runtime.lastRunSummary = { runNumber: run.id, passed: true, parsedPrimary: 80 };

		const result = await env.tool.execute({
			metric: 80,
			status: "keep",
			description: "Baseline run",
			metrics: { test_count: 100, expect_calls: 200 },
		});

		expect(result.title).toBe("log_experiment");
		expect(result.output).toContain("keep");
		expect(result.output).toContain("80");
		expect(result.metadata.runId).toBe(run.id);
		expect(result.metadata.status).toBe("keep");
		expect(result.metadata.metric).toBe(80);

		// Verify runtime was updated
		expect(env.runtime.justLoggedExperiment).toBe(true);
		expect(env.runtime.needsCompaction).toBe(true);
		expect(env.runtime.lastRunSummary).toBeNull();

		env.cleanup();
	});

	it("logs a discard run", async () => {
		const env = createTestEnv();

		const run = env.storage.insertRun({
			sessionId: env.session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});
		env.runtime.lastRunSummary = { runNumber: run.id, passed: true, parsedPrimary: 70 };

		const result = await env.tool.execute({
			metric: 70,
			status: "discard",
			description: "Regression",
			justification: "Coverage dropped due to bad changes",
		});

		expect(result.output).toContain("discard");
		expect(result.metadata.status).toBe("discard");

		env.cleanup();
	});

	it("logs a crash run", async () => {
		const env = createTestEnv();

		const run = env.storage.insertRun({
			sessionId: env.session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});
		env.runtime.lastRunSummary = { runNumber: run.id, passed: false, parsedPrimary: null };

		const result = await env.tool.execute({
			metric: 0,
			status: "crash",
			description: "Build failed",
		});

		expect(result.output).toContain("crash");

		env.cleanup();
	});

	it("logs a checks_failed run", async () => {
		const env = createTestEnv();

		const run = env.storage.insertRun({
			sessionId: env.session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});
		env.runtime.lastRunSummary = { runNumber: run.id, passed: false, parsedPrimary: 60 };

		const result = await env.tool.execute({
			metric: 60,
			status: "checks_failed",
			description: "Tests failed",
		});

		expect(result.output).toContain("checks_failed");

		env.cleanup();
	});

	it("handles ASI data", async () => {
		const env = createTestEnv();

		const run = env.storage.insertRun({
			sessionId: env.session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});
		env.runtime.lastRunSummary = { runNumber: run.id, passed: true, parsedPrimary: 85 };

		const result = await env.tool.execute({
			metric: 85,
			status: "keep",
			description: "Improved coverage",
			asi: {
				hypothesis: "Adding tests for uncovered modules",
				next_action_hint: "Focus on log-experiment.ts next",
			},
		});

		expect(result.output).toContain("keep");

		env.cleanup();
	});

	it("rebuilds experiment state after logging", async () => {
		const env = createTestEnv();

		const run = env.storage.insertRun({
			sessionId: env.session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});
		env.runtime.lastRunSummary = { runNumber: run.id, passed: true, parsedPrimary: 82 };

		await env.tool.execute({
			metric: 82,
			status: "keep",
			description: "Added more tests",
		});

		// State should be rebuilt with results
		expect(env.runtime.state.results.length).toBeGreaterThanOrEqual(1);
		expect(env.runtime.state.name).toBe("Test");

		env.cleanup();
	});

	it("shows stats in output including baseline", async () => {
		const env = createTestEnv();

		const run = env.storage.insertRun({
			sessionId: env.session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});
		env.runtime.lastRunSummary = { runNumber: run.id, passed: true, parsedPrimary: 79 };

		const result = await env.tool.execute({
			metric: 79,
			status: "keep",
			description: "Baseline",
		});

		expect(result.output).toContain("Stats");
		expect(result.output).toContain("Baseline");

		env.cleanup();
	});

	it("shows additional metrics in output", async () => {
		const env = createTestEnv();

		const run = env.storage.insertRun({
			sessionId: env.session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});
		env.runtime.lastRunSummary = { runNumber: run.id, passed: true, parsedPrimary: 85 };

		const result = await env.tool.execute({
			metric: 85,
			status: "keep",
			description: "Improved",
			metrics: { test_count: 200, expect_calls: 400 },
		});

		expect(result.output).toContain("test_count=200");
		expect(result.output).toContain("expect_calls=400");

		env.cleanup();
	});

	it("filters non-numeric metrics", async () => {
		const env = createTestEnv();

		const run = env.storage.insertRun({
			sessionId: env.session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});
		env.runtime.lastRunSummary = { runNumber: run.id, passed: true, parsedPrimary: 85 };

		const result = await env.tool.execute({
			metric: 85,
			status: "keep",
			description: "Filtered metrics",
			metrics: { valid: 100, invalid: "not_a_number" as any },
		});

		// Only numeric metrics should be kept
		expect(result.output).toContain("valid=100");

		env.cleanup();
	});

	it("disables autoresearch mode when max iterations reached", async () => {
		const env = createTestEnv();

		// Insert and log runs until we reach max
		for (let i = 0; i < 10; i++) {
			const run = env.storage.insertRun({
				sessionId: env.session.id,
				segment: 0,
				command: "bash autoresearch.sh",
				logPath: `/tmp/run${i}.log`,
				preRunDirtyPaths: [],
				startedAt: Date.now(),
			});
			env.runtime.lastRunSummary = { runNumber: run.id, passed: true, parsedPrimary: 80 + i };
			await env.tool.execute({
				metric: 80 + i,
				status: "keep",
				description: `Run ${i + 1}`,
			});
		}

		expect(env.runtime.autoresearchMode).toBe(false);

		env.cleanup();
	});
});
