// types.ts
// Central type definitions for the autoresearch plugin.

export type ExperimentStatus = "keep" | "discard" | "crash" | "checks_failed";

export type MetricDirection = "lower" | "higher";

export type NumericMetricMap = Record<string, number>;

export type ASIValue = string | number | boolean | null | ASIValue[] | ASIData;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export interface ASIData {
	[key: string]: ASIValue;
}

export interface MetricDef {
	name: string;
	unit: string;
}

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

export interface PendingRunSummary {
	runNumber: number;
	passed: boolean;
	parsedPrimary: number | null;
}

export interface RunningExperiment {
	startedAt: number;
	command: string;
	runNumber: number;
}

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

export interface InsertRunParams {
	sessionId: number;
	segment: number;
	command: string;
	logPath: string;
	preRunDirtyPaths: string[];
	startedAt: number;
}

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

export interface RuntimeStore {
	clear(sessionKey: string): void;
	ensure(sessionKey: string): AutoresearchRuntime;
}

export interface DirtyPathEntry {
	path: string;
	untracked: boolean;
}
