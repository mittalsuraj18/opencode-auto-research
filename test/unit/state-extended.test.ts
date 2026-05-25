import { describe, expect, it } from "bun:test";
import type { ExperimentResult, SessionRow } from "../../src/types";
import {
	buildExperimentState,
	findBaselineSecondary,
	sortedMedian,
} from "../../src/state";

describe("findBaselineSecondary — uncovered paths", () => {
	it("skips flagged results when looking for fallback metric", () => {
		const results: ExperimentResult[] = [
			{
				segment: 0,
				runNumber: 1,
				status: "discard",
				metric: 100,
				metrics: { bundle_size: 500 },
				flagged: true,
			} as ExperimentResult,
			{
				segment: 0,
				runNumber: 2,
				status: "discard",
				metric: 200,
				metrics: { bundle_size: 600 },
				flagged: false,
			} as ExperimentResult,
		];
		// bundle_size not in baseline, should fall back to first non-flagged run
		const secondary = findBaselineSecondary(results, 0, [{ name: "bundle_size", unit: "bytes" }]);
		expect(secondary.bundle_size).toBe(600);
	});

	it("returns undefined for metric not found in any result", () => {
		const results: ExperimentResult[] = [
			{
				segment: 0,
				runNumber: 1,
				status: "keep",
				metric: 100,
				metrics: { other_metric: 42 },
			} as ExperimentResult,
		];
		const secondary = findBaselineSecondary(results, 0, [{ name: "missing_metric", unit: "bytes" }]);
		expect(secondary.missing_metric).toBeUndefined();
	});
});

describe("buildExperimentState — with secondary metrics", () => {
	it("maps secondary metric names from session", () => {
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
			secondaryMetrics: ["bundle_size_bytes", "memory_mb"],
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
				metrics: { compile_time_ms: 100, bundle_size_bytes: 45000, memory_mb: 128 },
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
		// Session provides 2 secondary metrics, run may add compile_time_ms as well
		expect(state.secondaryMetrics.length).toBeGreaterThanOrEqual(2);
		const bundleSize = state.secondaryMetrics.find((m) => m.name === "bundle_size_bytes");
		const memoryMb = state.secondaryMetrics.find((m) => m.name === "memory_mb");
		expect(bundleSize).toBeDefined();
		// _bytes is not a recognized suffix, so unit should be ""
		expect(bundleSize?.unit).toBe("");
		expect(memoryMb).toBeDefined();
		expect(memoryMb?.unit).toBe("mb");
	});
});

describe("sortedMedian — additional cases", () => {
	it("handles single element", () => {
		expect(sortedMedian([42])).toBe(42);
	});

	it("handles two elements", () => {
		expect(sortedMedian([10, 20])).toBe(15);
	});

	it("handles negative numbers", () => {
		expect(sortedMedian([-5, -3, -1])).toBe(-3);
	});
});
