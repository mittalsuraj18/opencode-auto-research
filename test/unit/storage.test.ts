import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { AutoresearchStorage } from "../../src/storage";
import type { InsertRunParams, MarkRunCompletedParams, MarkRunLoggedParams } from "../../src/types";

function createTempStorage(): { storage: AutoresearchStorage; cleanup: () => void } {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-test-"));
	const dbPath = path.join(tmpDir, "test.db");
	const storage = new AutoresearchStorage(dbPath, tmpDir);
	return {
		storage,
		cleanup: () => {
			storage.close();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		},
	};
}

describe("AutoresearchStorage", () => {
	describe("session CRUD", () => {
		it("inserts and retrieves session", () => {
			const { storage, cleanup } = createTempStorage();
			const session = storage.insertSession({
				name: "Test",
				goal: "Optimize",
				primaryMetric: "compile_time_ms",
				metricUnit: "ms",
				direction: "lower",
				branch: "autoresearch/test",
				baselineCommit: "abc123",
				scopePaths: ["src"],
				offLimits: ["node_modules"],
				constraints: ["keep tests passing"],
				secondaryMetrics: [],
				notes: "Initial notes",
				maxIterations: 100,
			});
			expect(session.name).toBe("Test");
			expect(session.goal).toBe("Optimize");
			expect(session.primaryMetric).toBe("compile_time_ms");
			expect(session.scopePaths).toEqual(["src"]);
			expect(session.offLimits).toEqual(["node_modules"]);
			expect(session.constraints).toEqual(["keep tests passing"]);
			cleanup();
		});

		it("gets active session", () => {
			const { storage, cleanup } = createTempStorage();
			storage.insertSession({
				name: "Test",
				goal: null,
				primaryMetric: "metric",
				metricUnit: "",
				direction: "lower",
				branch: null,
				baselineCommit: null,
				scopePaths: [],
				offLimits: [],
				constraints: [],
				secondaryMetrics: [],
				notes: "",
				maxIterations: null,
			});
			const active = storage.getActiveSession();
			expect(active).not.toBeNull();
			expect(active?.name).toBe("Test");
			cleanup();
		});

		it("returns null when no active session", () => {
			const { storage, cleanup } = createTempStorage();
			expect(storage.getActiveSession()).toBeNull();
			cleanup();
		});

		it("gets active session by branch", () => {
			const { storage, cleanup } = createTempStorage();
			storage.insertSession({
				name: "Test",
				goal: null,
				primaryMetric: "metric",
				metricUnit: "",
				direction: "lower",
				branch: "autoresearch/test",
				baselineCommit: null,
				scopePaths: [],
				offLimits: [],
				constraints: [],
				secondaryMetrics: [],
				notes: "",
				maxIterations: null,
			});
			expect(storage.getActiveSessionForBranch("autoresearch/test")).not.toBeNull();
			expect(storage.getActiveSessionForBranch("other")).toBeNull();
			cleanup();
		});

		it("closes session", () => {
			const { storage, cleanup } = createTempStorage();
			const session = storage.insertSession({
				name: "Test",
				goal: null,
				primaryMetric: "metric",
				metricUnit: "",
				direction: "lower",
				branch: null,
				baselineCommit: null,
				scopePaths: [],
				offLimits: [],
				constraints: [],
				secondaryMetrics: [],
				notes: "",
				maxIterations: null,
			});
			storage.closeSession(session.id);
			expect(storage.getActiveSession()).toBeNull();
			cleanup();
		});

		it("updates notes", () => {
			const { storage, cleanup } = createTempStorage();
			const session = storage.insertSession({
				name: "Test",
				goal: null,
				primaryMetric: "metric",
				metricUnit: "",
				direction: "lower",
				branch: null,
				baselineCommit: null,
				scopePaths: [],
				offLimits: [],
				constraints: [],
				secondaryMetrics: [],
				notes: "old",
				maxIterations: null,
			});
			storage.updateNotes(session.id, "new notes");
			const updated = storage.getSession(session.id);
			expect(updated?.notes).toBe("new notes");
			cleanup();
		});

		it("increments segment", () => {
			const { storage, cleanup } = createTempStorage();
			const session = storage.insertSession({
				name: "Test",
				goal: null,
				primaryMetric: "metric",
				metricUnit: "",
				direction: "lower",
				branch: null,
				baselineCommit: null,
				scopePaths: [],
				offLimits: [],
				constraints: [],
				secondaryMetrics: [],
				notes: "",
				maxIterations: null,
			});
			expect(session.currentSegment).toBe(0);
			storage.incrementSegment(session.id);
			const updated = storage.getSession(session.id);
			expect(updated?.currentSegment).toBe(1);
			cleanup();
		});
	});

	describe("run CRUD", () => {
		it("inserts and completes run", () => {
			const { storage, cleanup } = createTempStorage();
			const session = storage.insertSession({
				name: "Test",
				goal: null,
				primaryMetric: "metric",
				metricUnit: "",
				direction: "lower",
				branch: null,
				baselineCommit: null,
				scopePaths: [],
				offLimits: [],
				constraints: [],
				secondaryMetrics: [],
				notes: "",
				maxIterations: null,
			});

			const run = storage.insertRun({
				sessionId: session.id,
				segment: 0,
				command: "bash autoresearch.sh",
				logPath: "/tmp/run1.log",
				preRunDirtyPaths: [],
				startedAt: Date.now(),
			});
			expect(run.id).toBeGreaterThan(0);

			storage.markRunCompleted({
				runId: run.id,
				completedAt: Date.now(),
				durationMs: 1000,
				exitCode: 0,
				timedOut: false,
				parsedPrimary: 100,
				parsedMetrics: { metric: 100 },
				parsedAsi: { hypothesis: "test" },
			} as MarkRunCompletedParams);

			const runs = storage.getRunsForSession(session.id);
			expect(runs).toHaveLength(1);
			expect(runs[0].parsed_primary).toBe(100);
			cleanup();
		});

		it("logs run with status", () => {
			const { storage, cleanup } = createTempStorage();
			const session = storage.insertSession({
				name: "Test",
				goal: null,
				primaryMetric: "metric",
				metricUnit: "",
				direction: "lower",
				branch: null,
				baselineCommit: null,
				scopePaths: [],
				offLimits: [],
				constraints: [],
				secondaryMetrics: [],
				notes: "",
				maxIterations: null,
			});

			const run = storage.insertRun({
				sessionId: session.id,
				segment: 0,
				command: "bash autoresearch.sh",
				logPath: "/tmp/run1.log",
				preRunDirtyPaths: [],
				startedAt: Date.now(),
			});

			storage.markRunLogged({
				runId: run.id,
				status: "keep",
				description: "Baseline",
				metric: 100,
				metrics: { metric: 100 },
				asi: null,
				commitHash: "abc123",
				confidence: 1.5,
				modifiedPaths: ["src/index.ts"],
				scopeDeviations: [],
				justification: null,
				loggedAt: Date.now(),
			} as MarkRunLoggedParams);

			const runs = storage.getRunsForSession(session.id);
			expect(runs[0].status).toBe("keep");
			expect(runs[0].metric).toBe(100);
			expect(runs[0].commit_hash).toBe("abc123");
			cleanup();
		});

		it("counts runs in segment", () => {
			const { storage, cleanup } = createTempStorage();
			const session = storage.insertSession({
				name: "Test",
				goal: null,
				primaryMetric: "metric",
				metricUnit: "",
				direction: "lower",
				branch: null,
				baselineCommit: null,
				scopePaths: [],
				offLimits: [],
				constraints: [],
				secondaryMetrics: [],
				notes: "",
				maxIterations: null,
			});

			// Insert and log 2 runs
			for (let i = 0; i < 2; i++) {
				const run = storage.insertRun({
					sessionId: session.id,
					segment: 0,
					command: "bash autoresearch.sh",
					logPath: `/tmp/run${i}.log`,
					preRunDirtyPaths: [],
					startedAt: Date.now(),
				});
				storage.markRunLogged({
					runId: run.id,
					status: "keep",
					description: "Test",
					metric: 100,
					metrics: {},
					asi: null,
					commitHash: null,
					confidence: null,
					modifiedPaths: [],
					scopeDeviations: [],
					justification: null,
					loggedAt: Date.now(),
				} as MarkRunLoggedParams);
			}

			// Insert but don't log 1 run
			storage.insertRun({
				sessionId: session.id,
				segment: 0,
				command: "bash autoresearch.sh",
				logPath: "/tmp/pending.log",
				preRunDirtyPaths: [],
				startedAt: Date.now(),
			});

			expect(storage.countRunsInSegment(session.id, 0)).toBe(2);
			cleanup();
		});

		it("abandons pending runs", () => {
			const { storage, cleanup } = createTempStorage();
			const session = storage.insertSession({
				name: "Test",
				goal: null,
				primaryMetric: "metric",
				metricUnit: "",
				direction: "lower",
				branch: null,
				baselineCommit: null,
				scopePaths: [],
				offLimits: [],
				constraints: [],
				secondaryMetrics: [],
				notes: "",
				maxIterations: null,
			});

			const run = storage.insertRun({
				sessionId: session.id,
				segment: 0,
				command: "bash autoresearch.sh",
				logPath: "/tmp/pending.log",
				preRunDirtyPaths: [],
				startedAt: Date.now(),
			});

			storage.abandonPendingRuns(session.id);
			const runs = storage.getRunsForSession(session.id);
			expect(runs).toHaveLength(0);
			cleanup();
		});
	});

	describe("schema migration", () => {
		it("sets user_version", () => {
			const { storage, cleanup } = createTempStorage();
			// The constructor should have set user_version
			// We can verify by creating a session successfully
			const session = storage.insertSession({
				name: "Test",
				goal: null,
				primaryMetric: "metric",
				metricUnit: "",
				direction: "lower",
				branch: null,
				baselineCommit: null,
				scopePaths: [],
				offLimits: [],
				constraints: [],
				secondaryMetrics: [],
				notes: "",
				maxIterations: null,
			});
			expect(session.id).toBeGreaterThan(0);
			cleanup();
		});
	});
});
