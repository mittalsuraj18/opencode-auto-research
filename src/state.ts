// state.ts
// Experiment state builders and confidence computation.

import type {
	ExperimentResult,
	ExperimentState,
	MetricDirection,
	NumericMetricMap,
	SessionRow,
} from "./types";
import { inferMetricUnitFromName, isBetter } from "./helpers";

export function createExperimentState(): ExperimentState {
	return {
		name: "",
		goal: null,
		metricName: "",
		metricUnit: "",
		bestDirection: "lower",
		scopePaths: [],
		offLimits: [],
		constraints: [],
		notes: "",
		branch: null,
		baselineCommit: null,
		sessionId: 0,
		maxExperiments: null,
		currentSegment: 0,
		secondaryMetrics: [],
		results: [],
		bestMetric: null,
		confidence: null,
	};
}

export function currentResults(results: ExperimentResult[], segment: number): ExperimentResult[] {
	return results.filter((result) => result.segment === segment);
}

export function findBaselineResult(results: ExperimentResult[], segment: number): ExperimentResult | null {
	const current = currentResults(results, segment);
	for (const result of current) {
		if (result.status === "keep" && result.metric > 0) {
			return result;
		}
	}
	return null;
}

export function findBaselineMetric(results: ExperimentResult[], segment: number): number | null {
	const baseline = findBaselineResult(results, segment);
	return baseline ? baseline.metric : null;
}

export function findBaselineRunNumber(results: ExperimentResult[], segment: number): number | null {
	const baseline = findBaselineResult(results, segment);
	if (!baseline) return null;
	return baseline.runNumber;
}

export function findBaselineSecondary(
	results: ExperimentResult[],
	segment: number,
	knownMetrics: Array<{ name: string; unit: string }>,
): NumericMetricMap {
	const baseline = findBaselineResult(results, segment);
	const values: NumericMetricMap = baseline ? { ...baseline.metrics } : {};
	for (const metric of knownMetrics) {
		if (values[metric.name] !== undefined) continue;
		for (const result of currentResults(results, segment)) {
			if (result.flagged) continue;
			const value = result.metrics[metric.name];
			if (value !== undefined) {
				values[metric.name] = value;
				break;
			}
		}
	}
	return values;
}

export function findBestKeptMetric(
	results: ExperimentResult[],
	segment: number,
	direction: MetricDirection,
): number | null {
	let best: number | null = null;
	for (const result of currentResults(results, segment)) {
		if (result.status !== "keep" || result.metric <= 0) continue;
		if (best === null || isBetter(result.metric, best, direction)) {
			best = result.metric;
		}
	}
	return best;
}

export function sortedMedian(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const midpoint = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
	}
	return sorted[midpoint];
}

export function computeConfidence(
	results: ExperimentResult[],
	segment: number,
	direction: MetricDirection,
): number | null {
	const current = currentResults(results, segment).filter((result) => !result.flagged && result.metric > 0);
	if (current.length < 3) return null;

	const values = current.map((result) => result.metric);
	const median = sortedMedian(values);
	const mad = sortedMedian(values.map((value) => Math.abs(value - median)));
	if (mad === 0) return null;

	const baseline = findBaselineMetric(results, segment);
	if (baseline === null) return null;

	let bestKept: number | null = null;
	for (const result of current) {
		if (result.status !== "keep" || result.metric <= 0) continue;
		if (bestKept === null || isBetter(result.metric, bestKept, direction)) {
			bestKept = result.metric;
		}
	}
	if (bestKept === null || bestKept === baseline) return null;

	return Math.abs(bestKept - baseline) / mad;
}

export function buildExperimentState(session: SessionRow, loggedRuns: Array<{
	id: number;
	segment: number;
	command: string;
	startedAt: number;
	completedAt: number | null;
	durationMs: number | null;
	exitCode: number | null;
	timedOut: boolean;
	parsedPrimary: number | null;
	parsedMetrics: NumericMetricMap | null;
	parsedAsi: Record<string, unknown> | null;
	preRunDirtyPaths: string[];
	logPath: string;
	status: string | null;
	description: string | null;
	metric: number | null;
	metrics: NumericMetricMap | null;
	asi: Record<string, unknown> | null;
	commitHash: string | null;
	confidence: number | null;
	modifiedPaths: string[];
	scopeDeviations: string[];
	justification: string | null;
	flagged: boolean;
	flaggedReason: string | null;
	loggedAt: number | null;
}>): ExperimentState {
	const state = createExperimentState();
	state.name = session.name;
	state.goal = session.goal;
	state.metricName = session.primaryMetric;
	state.metricUnit = session.metricUnit;
	state.bestDirection = session.direction;
	state.scopePaths = [...session.scopePaths];
	state.offLimits = [...session.offLimits];
	state.constraints = [...session.constraints];
	state.notes = session.notes;
	state.branch = session.branch;
	state.baselineCommit = session.baselineCommit;
	state.sessionId = session.id;
	state.maxExperiments = session.maxIterations;
	state.currentSegment = session.currentSegment;
	state.secondaryMetrics = session.secondaryMetrics.map((name) => ({
		name,
		unit: inferMetricUnitFromName(name),
	}));

	for (const run of loggedRuns) {
		if (run.status === null) continue;
		const result: ExperimentResult = {
			runNumber: run.id,
			commit: run.commitHash ?? "",
			metric: run.metric ?? 0,
			metrics: run.metrics ?? {},
			status: run.status as import("./types").ExperimentStatus,
			description: run.description ?? "",
			timestamp: run.loggedAt ?? run.startedAt,
			segment: run.segment,
			confidence: run.confidence,
			asi: (run.asi as import("./types").ASIData | undefined) ?? undefined,
			modifiedPaths: run.modifiedPaths,
			scopeDeviations: run.scopeDeviations,
			justification: run.justification,
			flagged: run.flagged,
			flaggedReason: run.flaggedReason,
		};
		state.results.push(result);
		if (run.segment === state.currentSegment) {
			registerSecondaryMetrics(state.secondaryMetrics, result.metrics);
		}
	}

	state.bestMetric = findBaselineMetric(state.results, state.currentSegment);
	state.confidence = computeConfidence(state.results, state.currentSegment, state.bestDirection);
	return state;
}

function registerSecondaryMetrics(
	metrics: Array<{ name: string; unit: string }>,
	values: NumericMetricMap,
): void {
	for (const name of Object.keys(values)) {
		if (metrics.some((metric) => metric.name === name)) continue;
		metrics.push({
			name,
			unit: inferMetricUnitFromName(name),
		});
	}
}

export function createRuntimeStore(): {
	clear(sessionKey: string): void;
	ensure(sessionKey: string): import("./types").AutoresearchRuntime;
} {
	const runtimes = new Map<string, import("./types").AutoresearchRuntime>();
	return {
		clear(sessionKey: string): void {
			runtimes.delete(sessionKey);
		},
		ensure(sessionKey: string): import("./types").AutoresearchRuntime {
			const existing = runtimes.get(sessionKey);
			if (existing) return existing;
			const runtime: import("./types").AutoresearchRuntime = {
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
			runtimes.set(sessionKey, runtime);
			return runtime;
		},
	};
}
