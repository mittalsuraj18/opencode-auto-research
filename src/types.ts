/**
 * @file types.ts
 * @description Central type definitions and interfaces for the autoresearch plugin.
 * Provides the core data models used throughout the experiment lifecycle.
 */

/** Status values for experiment run outcomes */
export type ExperimentStatus = "keep" | "discard" | "crash" | "checks_failed";

/** Direction for metric optimization: lower values are better (e.g., latency) or higher values are better (e.g., coverage) */
export type MetricDirection = "lower" | "higher";

/** Map of metric names to their numeric values */
export type NumericMetricMap = Record<string, number>;

/** Recursive type for Agent State Info values */
export type ASIValue = string | number | boolean | null | ASIValue[] | ASIData;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
/** Key-value structure for Agent State Info (ASI) metadata */
export interface ASIData {
	[key: string]: ASIValue;
}

/** Definition of a tracked metric with name and unit */
export interface MetricDef {
	name: string;
	unit: string;
}

/** Result of a single experiment run */
export interface ExperimentResult {
	runNumber: number;
	commit: string;
	metric: number;
	metrics: NumericMetricMap;
	status: ExperimentStatus;
	description: string;
	timestamp: number;
	segment: number;
	confidence: number | null;
	asi?: ASIData;
	modifiedPaths: string[];
	scopeDeviations: string[];
	justification: string | null;
	flagged: boolean;
	flaggedReason: string | null;
}

/** Complete state of an active or completed experiment session */
export interface ExperimentState {
	name: string;
	goal: string | null;
	metricName: string;
	metricUnit: string;
	bestDirection: MetricDirection;
	scopePaths: string[];
	offLimits: string[];
	constraints: string[];
	notes: string;
	branch: string | null;
	baselineCommit: string | null;
	sessionId: number;
	maxExperiments: number | null;
	currentSegment: number;
	secondaryMetrics: MetricDef[];
	results: ExperimentResult[];
	bestMetric: number | null;
	confidence: number | null;
}

/** Summary of a benchmark run awaiting logging */
export interface PendingRunSummary {
	runNumber: number;
	passed: boolean;
	parsedPrimary: number | null;
}

/** Active benchmark execution tracking */
export interface RunningExperiment {
	startedAt: number;
	command: string;
	runNumber: number;
}

/** Runtime state managed by the plugin for the current session */
export interface AutoresearchRuntime {
	autoresearchMode: boolean;
	goal: string | null;
	state: ExperimentState;
	runningExperiment: RunningExperiment | null;
	lastRunSummary: PendingRunSummary | null;
	lastAutoResumePendingRunNumber: number | null;
	justLoggedExperiment: boolean;
	needsCompaction: boolean;
	currentModel: { providerID: string; modelID: string } | null;
}

/** Database row representation of an experiment session */
export interface SessionRow {
	id: number;
	name: string;
	goal: string | null;
	primaryMetric: string;
	metricUnit: string;
	direction: MetricDirection;
	branch: string | null;
	baselineCommit: string | null;
	currentSegment: number;
	maxIterations: number | null;
	scopePaths: string[];
	offLimits: string[];
	constraints: string[];
	secondaryMetrics: string[];
	notes: string;
	createdAt: number;
	closedAt: number | null;
}

/** Parameters required to insert a new run record */
export interface InsertRunParams {
	sessionId: number;
	segment: number;
	command: string;
	logPath: string;
	preRunDirtyPaths: string[];
	startedAt: number;
}

/** Parameters for marking a run as completed after benchmark execution */
export interface MarkRunCompletedParams {
	runId: number;
	completedAt: number;
	durationMs: number;
	exitCode: number | null;
	timedOut: boolean;
	parsedPrimary: number | null;
	parsedMetrics: NumericMetricMap | null;
	parsedAsi: ASIData | null;
}

/** Parameters for logging a run result and its metadata */
export interface MarkRunLoggedParams {
	runId: number;
	status: ExperimentStatus;
	description: string;
	metric: number;
	metrics: NumericMetricMap;
	asi: ASIData | null;
	commitHash: string | null;
	confidence: number | null;
	modifiedPaths: string[];
	scopeDeviations: string[];
	justification: string | null;
	loggedAt: number;
}

/** Simple runtime store that manages AutoresearchRuntime instances per session key */
export interface RuntimeStore {
	clear(sessionKey: string): void;
	ensure(sessionKey: string): AutoresearchRuntime;
}

/** Entry representing a dirty git path with its untracked status */
export interface DirtyPathEntry {
	path: string;
	untracked: boolean;
}
