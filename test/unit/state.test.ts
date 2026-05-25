import { describe, expect, it } from "bun:test";
import type { ExperimentResult, SessionRow } from "../../src/types";
import {
	buildExperimentState,
	computeConfidence,
	createExperimentState,
	createRuntimeStore,
	currentResults,
	findBaselineMetric,
	findBaselineResult,
	findBaselineRunNumber,
	findBaselineSecondary,
	findBestKeptMetric,
	sortedMedian,
} from "../../src/state";

describe("createExperimentState", () => {
	it("returns default state", () => {
		const state = createExperimentState();
		expect(state.name).toBe("");
		expect(state.goal).toBeNull();
		expect(state.metricName).toBe("");
		expect(state.bestDirection).toBe("lower");
		expect(state.results).toEqual([]);
		expect(state.bestMetric).toBeNull();
		expect(state.confidence).toBeNull();
	});
});

describe("currentResults", () => {
	it("filters by segment", () => {
		const results: ExperimentResult[] = [
			{ segment: 0, runNumber: 1, status: "keep", metric: 100 } as ExperimentResult,
			{ segment: 1, runNumber: 2, status: "keep", metric: 200 } as ExperimentResult,
		];
		expect(currentResults(results, 0)).toHaveLength(1);
		expect(currentResults(results, 1)).toHaveLength(1);
	});

	it("returns empty for no matches", () => {
		expect(currentResults([], 0)).toEqual([]);
	});
});

describe("findBaselineResult", () => {
	it("finds first keep with metric > 0", () => {
		const results: ExperimentResult[] = [
			{ segment: 0, runNumber: 1, status: "discard", metric: 100 } as ExperimentResult,
			{ segment: 0, runNumber: 2, status: "keep", metric: 100 } as ExperimentResult,
		];
		const baseline = findBaselineResult(results, 0);
		expect(baseline?.runNumber).toBe(2);
	});

	it("returns null when no keep", () => {
		const results: ExperimentResult[] = [
			{ segment: 0, runNumber: 1, status: "discard", metric: 100 } as ExperimentResult,
		];
		expect(findBaselineResult(results, 0)).toBeNull();
	});

	it("skips metric <= 0", () => {
		const results: ExperimentResult[] = [
			{ segment: 0, runNumber: 1, status: "keep", metric: 0 } as ExperimentResult,
			{ segment: 0, runNumber: 2, status: "keep", metric: 100 } as ExperimentResult,
		];
		expect(findBaselineResult(results, 0)?.runNumber).toBe(2);
	});
});

describe("findBaselineMetric", () => {
	it("returns baseline metric value", () => {
		const results: ExperimentResult[] = [
			{ segment: 0, runNumber: 1, status: "keep", metric: 100 } as ExperimentResult,
		];
		expect(findBaselineMetric(results, 0)).toBe(100);
	});

	it("returns null when no baseline", () => {
		expect(findBaselineMetric([], 0)).toBeNull();
	});
});

describe("findBaselineRunNumber", () => {
	it("returns run number", () => {
		const results: ExperimentResult[] = [
			{ segment: 0, runNumber: 5, status: "keep", metric: 100 } as ExperimentResult,
		];
		expect(findBaselineRunNumber(results, 0)).toBe(5);
	});

	it("returns null when no baseline", () => {
		expect(findBaselineRunNumber([], 0)).toBeNull();
	});
});

describe("findBaselineSecondary", () => {
	it("returns baseline secondary metrics", () => {
		const results: ExperimentResult[] = [
			{
				segment: 0,
				runNumber: 1,
				status: "keep",
				metric: 100,
				metrics: { bundle_size: 500 },
			} as ExperimentResult,
		];
		const secondary = findBaselineSecondary(results, 0, [{ name: "bundle_size", unit: "bytes" }]);
		expect(secondary.bundle_size).toBe(500);
	});

	it("falls back to first non-flagged run", () => {
		const results: ExperimentResult[] = [
			{
				segment: 0,
				runNumber: 1,
				status: "discard",
				metric: 100,
				metrics: { bundle_size: 500 },
			} as ExperimentResult,
			{
				segment: 0,
				runNumber: 2,
				status: "discard",
				metric: 200,
				metrics: { bundle_size: 600 },
				flagged: true,
			} as ExperimentResult,
		];
		const secondary = findBaselineSecondary(results, 0, [{ name: "bundle_size", unit: "bytes" }]);
		expect(secondary.bundle_size).toBe(500);
	});
});

describe("findBestKeptMetric", () => {
	it("finds best for lower direction", () => {
		const results: ExperimentResult[] = [
			{ segment: 0, runNumber: 1, status: "keep", metric: 100 } as ExperimentResult,
			{ segment: 0, runNumber: 2, status: "keep", metric: 50 } as ExperimentResult,
		];
		expect(findBestKeptMetric(results, 0, "lower")).toBe(50);
	});

	it("finds best for higher direction", () => {
		const results: ExperimentResult[] = [
			{ segment: 0, runNumber: 1, status: "keep", metric: 100 } as ExperimentResult,
			{ segment: 0, runNumber: 2, status: "keep", metric: 150 } as ExperimentResult,
		];
		expect(findBestKeptMetric(results, 0, "higher")).toBe(150);
	});

	it("ignores non-keep", () => {
		const results: ExperimentResult[] = [
			{ segment: 0, runNumber: 1, status: "discard", metric: 10 } as ExperimentResult,
			{ segment: 0, runNumber: 2, status: "keep", metric: 100 } as ExperimentResult,
		];
		expect(findBestKeptMetric(results, 0, "lower")).toBe(100);
	});

	it("returns null for empty", () => {
		expect(findBestKeptMetric([], 0, "lower")).toBeNull();
	});
});

describe("sortedMedian", () => {
	it("returns median for odd length", () => {
		expect(sortedMedian([3, 1, 2])).toBe(2);
	});

	it("returns median for even length", () => {
		expect(sortedMedian([1, 2, 3, 4])).toBe(2.5);
	});

	it("returns 0 for empty", () => {
		expect(sortedMedian([])).toBe(0);
	});
});

describe("computeConfidence", () => {
	it("returns null for < 3 runs", () => {
		const results: ExperimentResult[] = [
			{ segment: 0, runNumber: 1, status: "keep", metric: 100 } as ExperimentResult,
			{ segment: 0, runNumber: 2, status: "keep", metric: 90 } as ExperimentResult,
		];
		expect(computeConfidence(results, 0, "lower")).toBeNull();
	});

	it("returns null when MAD is 0", () => {
		const results: ExperimentResult[] = [
			{ segment: 0, runNumber: 1, status: "keep", metric: 100 } as ExperimentResult,
			{ segment: 0, runNumber: 2, status: "keep", metric: 100 } as ExperimentResult,
			{ segment: 0, runNumber: 3, status: "keep", metric: 100 } as ExperimentResult,
		];
		expect(computeConfidence(results, 0, "lower")).toBeNull();
	});

	it("returns null when baseline is null", () => {
		const results: ExperimentResult[] = [
			{ segment: 0, runNumber: 1, status: "discard", metric: 100 } as ExperimentResult,
			{ segment: 0, runNumber: 2, status: "discard", metric: 90 } as ExperimentResult,
			{ segment: 0, runNumber: 3, status: "discard", metric: 80 } as ExperimentResult,
		];
		expect(computeConfidence(results, 0, "lower")).toBeNull();
	});

	it("computes confidence for valid data", () => {
		const results: ExperimentResult[] = [
			{ segment: 0, runNumber: 1, status: "keep", metric: 100 } as ExperimentResult,
			{ segment: 0, runNumber: 2, status: "keep", metric: 90 } as ExperimentResult,
			{ segment: 0, runNumber: 3, status: "keep", metric: 80 } as ExperimentResult,
			{ segment: 0, runNumber: 4, status: "keep", metric: 70 } as ExperimentResult,
		];
		const confidence = computeConfidence(results, 0, "lower");
		expect(confidence).toBeGreaterThan(0);
	});

	it("returns null when best equals baseline", () => {
		const results: ExperimentResult[] = [
			{ segment: 0, runNumber: 1, status: "keep", metric: 100 } as ExperimentResult,
			{ segment: 0, runNumber: 2, status: "keep", metric: 100 } as ExperimentResult,
			{ segment: 0, runNumber: 3, status: "keep", metric: 90 } as ExperimentResult,
		];
		expect(computeConfidence(results, 0, "lower")).toBeNull();
	});
});

describe("buildExperimentState", () => {
	it("builds state from session and runs", () => {
		const session: SessionRow = {
			id: 1,
			name: "Test",
			goal: "Optimize",
			primaryMetric: "compile_time_ms",
			metricUnit: "ms",
			direction: "lower",
			branch: "autoresearch/test",
			baselineCommit: "abc123",
			currentSegment: 0,
			maxIterations: 100,
			scopePaths: ["src"],
			offLimits: ["node_modules"],
			constraints: [],
			secondaryMetrics: [],
			notes: "Some notes",
			createdAt: Date.now(),
			closedAt: null,
		};

		const loggedRuns = [
			{
				id: 1,
				segment: 0,
				command: "bash autoresearch.sh",
				startedAt: Date.now(),
				completedAt: Date.now(),
				durationMs: 1000,
				exitCode: 0,
				timedOut: false,
				parsedPrimary: 100,
				parsedMetrics: { compile_time_ms: 100 },
				parsedAsi: null,
				preRunDirtyPaths: [],
				logPath: "/tmp/run1.log",
				status: "keep",
				description: "Baseline",
				metric: 100,
				metrics: { compile_time_ms: 100 },
				asi: null,
				commitHash: "abc123",
				confidence: null,
				modifiedPaths: [],
				scopeDeviations: [],
				justification: null,
				flagged: false,
				flaggedReason: null,
				loggedAt: Date.now(),
			},
		];

		const state = buildExperimentState(session, loggedRuns);
		expect(state.name).toBe("Test");
		expect(state.goal).toBe("Optimize");
		expect(state.metricName).toBe("compile_time_ms");
		expect(state.bestMetric).toBe(100);
		expect(state.results).toHaveLength(1);
		expect(state.results[0].runNumber).toBe(1);
	});

	it("skips unlogged runs", () => {
		const session: SessionRow = {
			id: 1,
			name: "Test",
			goal: null,
			primaryMetric: "metric",
			metricUnit: "",
			direction: "lower",
			branch: null,
			baselineCommit: null,
			currentSegment: 0,
			maxIterations: null,
			scopePaths: [],
			offLimits: [],
			constraints: [],
			secondaryMetrics: [],
			notes: "",
			createdAt: Date.now(),
			closedAt: null,
		};

		const loggedRuns = [
			{
				id: 1,
				segment: 0,
				command: "bash autoresearch.sh",
				startedAt: Date.now(),
				completedAt: null,
				durationMs: null,
				exitCode: null,
				timedOut: false,
				parsedPrimary: null,
				parsedMetrics: null,
				parsedAsi: null,
				preRunDirtyPaths: [],
				logPath: "/tmp/run1.log",
				status: null,
				description: null,
				metric: null,
				metrics: null,
				asi: null,
				commitHash: null,
				confidence: null,
				modifiedPaths: [],
				scopeDeviations: [],
				justification: null,
				flagged: false,
				flaggedReason: null,
				loggedAt: null,
			},
		];

		const state = buildExperimentState(session, loggedRuns);
		expect(state.results).toHaveLength(0);
	});
});

describe("createRuntimeStore", () => {
	it("creates runtime on first access", () => {
		const store = createRuntimeStore();
		const runtime = store.ensure("test-key");
		expect(runtime.autoresearchMode).toBe(false);
		expect(runtime.state.name).toBe("");
	});

	it("returns existing runtime", () => {
		const store = createRuntimeStore();
		const runtime1 = store.ensure("test-key");
		runtime1.autoresearchMode = true;
		const runtime2 = store.ensure("test-key");
		expect(runtime2.autoresearchMode).toBe(true);
	});

	it("clears runtime", () => {
		const store = createRuntimeStore();
		store.ensure("test-key");
		store.clear("test-key");
		const runtime = store.ensure("test-key");
		expect(runtime.autoresearchMode).toBe(false);
	});
});
