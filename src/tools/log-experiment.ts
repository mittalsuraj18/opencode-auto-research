/**
 * @file tools/log-experiment.ts
 * @description Provides the log_experiment tool for recording benchmark results.
 * Handles git operations, scope deviation detection, and autoresearch.md updates.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import type { AutoresearchRuntime, ExperimentStatus } from "../types";
import type { AutoresearchStorage } from "../storage";
import {
	computeConfidence,
	findBaselineMetric,
	findBaselineRunNumber,
	findBestKeptMetric,
} from "../state";
import {
	computeRunModifiedPaths,
	ensureNumericMetricMap,
	formatNum,
	parseWorkDirDirtyPaths,
	pathMatchesSpec,
	sanitizeAsi,
	tryGitPrefix,
	tryGitStatus,
} from "../helpers";
import {
	gitAdd,
	gitClean,
	gitCommit,
	gitResetHard,
	gitRestoreFiles,
	getCurrentBranch,
	isAutoresearchBranch,
} from "../git";

/**
 * Creates the log_experiment tool for recording and managing experiment results.
 * @param storage - AutoresearchStorage instance for persistence
 * @param runtime - AutoresearchRuntime for managing active state
 * @param directory - Project directory path
 * @param client - OpenCode client instance
 * @returns Configured tool instance
 */
export function createLogExperimentTool({
	storage,
	runtime,
	directory,
	client,
}: {
	storage: AutoresearchStorage;
	runtime: AutoresearchRuntime;
	directory: string;
	client: any; // opencode client
}) {
	return tool({
		description: "Log the result of a benchmark run and update the experiment state",
		args: {
			metric: z.number().describe("The primary metric value for this run"),
			status: z
				.enum(["keep", "discard", "crash", "checks_failed"])
				.describe("Whether to keep this run's changes or discard them"),
			description: z.string().describe("Brief description of what this run tested"),
			metrics: z
				.record(z.string(), z.number())
				.optional()
				.describe("Additional metrics from this run"),
			asi: z
				.record(z.string(), z.unknown())
				.optional()
				.describe("Agent State Info (hypothesis, next_action_hint, etc.)"),
			justification: z
				.string()
				.optional()
				.describe("Why this result occurred or why you chose this status"),
		},
		execute: async (args) => {
			const session = storage.getActiveSession();
			if (!session) {
				return {
					title: "log_experiment",
					output: "No active experiment session. Call init_experiment first.",
					metadata: { error: "no_session" },
				};
			}

			if (!runtime.lastRunSummary) {
				return {
					title: "log_experiment",
					output: "No pending run to log. Call run_experiment first.",
					metadata: { error: "no_pending_run" },
				};
			}

			const runId = runtime.lastRunSummary.runNumber;
			const runRows = storage.getRunsForSession(session.id);
			const runRow = runRows.find((r) => r.id === runId);
			if (!runRow) {
				return {
					title: "log_experiment",
					output: `Run #${runId} not found in storage.`,
					metadata: { error: "run_not_found" },
				};
			}

			// Compute scope deviations
			const workDirPrefix = await tryGitPrefix(directory);
			const currentStatus = await tryGitStatus(directory);
			const preRunDirtyPaths = safeParseJson<string[]>(runRow.pre_run_dirty_paths_json, []);
			let modifiedPaths: string[] = [];
			if (currentStatus) {
				const { tracked, untracked } = computeRunModifiedPaths(
					preRunDirtyPaths,
					currentStatus,
					workDirPrefix,
				);
				modifiedPaths = [...tracked, ...untracked];
			}

			// Detect scope deviations
			const scopeDeviations: string[] = [];
			for (const modifiedPath of modifiedPaths) {
				let inScope = false;
				for (const scopePath of session.scopePaths) {
					if (pathMatchesSpec(modifiedPath, scopePath)) {
						inScope = true;
						break;
					}
				}
				let isOffLimits = false;
				for (const offLimit of session.offLimits) {
					if (pathMatchesSpec(modifiedPath, offLimit)) {
						isOffLimits = true;
						break;
					}
				}
				if (!inScope || isOffLimits) {
					scopeDeviations.push(modifiedPath);
				}
			}

			// Handle git operations based on status
			const currentBranch = await getCurrentBranch(directory);
			const onAutoresearchBranch = currentBranch !== null && isAutoresearchBranch(currentBranch);
			let commitHash: string | null = null;
			let gitNote = "";

			if (args.status === "keep") {
				if (onAutoresearchBranch) {
					// Commit the changes
					const metricsJson = JSON.stringify({
						status: "keep",
						[session.primaryMetric]: args.metric,
						...args.metrics,
					});
					const commitMessage = `${args.description}\n\nResult: ${metricsJson}`;
					commitHash = await gitCommit(directory, commitMessage, modifiedPaths);
					if (commitHash) {
						gitNote = `Committed: ${commitHash.slice(0, 8)}`;
					} else {
						gitNote = "Warning: commit failed";
					}
				} else {
					gitNote = "Warning: auto-commit skipped — not on a dedicated autoresearch branch. Modified files remain in the worktree.";
				}
			} else {
				// discard, crash, or checks_failed — revert changes
				if (onAutoresearchBranch) {
					await gitResetHard(directory);
					await gitClean(directory);
					gitNote = "Worktree reset to HEAD";
				} else {
					// Only revert files that were NOT dirty before the run
					if (currentStatus) {
						const { tracked, untracked } = computeRunModifiedPaths(
							preRunDirtyPaths,
							currentStatus,
							workDirPrefix,
						);
						await gitRestoreFiles(directory, tracked);
						// Remove untracked files
						for (const untrackedPath of untracked) {
							try {
								fs.rmSync(path.join(directory, untrackedPath), { recursive: true });
							} catch {
								// ignore
							}
						}
						gitNote = `Reverted ${tracked.length + untracked.length} files`;
					}
				}
			}

			// Compute confidence
			const loggedRuns = runRows.filter((r) => r.status !== null && r.id !== runId);
			const existingResults = loggedRuns.map((r) => ({
				status: r.status as ExperimentStatus,
				metric: r.metric ?? 0,
				segment: r.segment,
				flagged: false,
			}));
			// Add current run for confidence calculation
			const allResultsForConfidence = [
				...existingResults,
				{ status: args.status as ExperimentStatus, metric: args.metric, segment: session.currentSegment, flagged: false },
			];
			const confidence = computeConfidence(
				allResultsForConfidence.map((r, i) => ({
					runNumber: runRows[i]?.id ?? runId,
					commit: "",
					metric: r.metric,
					metrics: {},
					status: r.status,
					description: "",
					timestamp: Date.now(),
					segment: r.segment,
					confidence: null,
					modifiedPaths: [],
					scopeDeviations: [],
					justification: null,
					flagged: false,
					flaggedReason: null,
				})),
				session.currentSegment,
				session.direction,
			);

			// Mark run as logged
			storage.markRunLogged({
				runId,
				status: args.status as ExperimentStatus,
				description: args.description,
				metric: args.metric,
				metrics: ensureNumericMetricMap(args.metrics as Record<string, number> | undefined),
				asi: sanitizeAsi(args.asi) ?? null,
				commitHash,
				confidence,
				modifiedPaths,
				scopeDeviations,
				justification: args.justification ?? null,
				loggedAt: Date.now(),
			});

			// Update runtime state
			runtime.justLoggedExperiment = true;
			runtime.needsCompaction = true;
			runtime.lastRunSummary = null;

			// Rebuild state
			const updatedRuns = storage.getRunsForSession(session.id);
			const { buildExperimentState } = await import("../state");
			runtime.state = buildExperimentState(
				session,
				updatedRuns.map((r) => ({
					id: r.id,
					segment: r.segment,
					command: r.command,
					startedAt: r.started_at,
					completedAt: r.completed_at,
					durationMs: r.duration_ms,
					exitCode: r.exit_code,
					timedOut: Boolean(r.timed_out),
					parsedPrimary: r.parsed_primary,
				parsedMetrics: safeParseJson<Record<string, number>>(r.parsed_metrics_json, {}),
				parsedAsi: safeParseJson<Record<string, unknown>>(r.parsed_asi_json, {}),
					preRunDirtyPaths: safeParseJson<string[]>(r.pre_run_dirty_paths_json, []),
					logPath: r.log_path,
					status: r.status,
					description: r.description,
					metric: r.metric,
				metrics: safeParseJson<Record<string, number>>(r.metrics_json, {}),
				asi: safeParseJson<Record<string, unknown>>(r.asi_json, {}),
					commitHash: r.commit_hash,
					confidence: r.confidence,
					modifiedPaths: safeParseJson<string[]>(r.modified_paths_json, []),
					scopeDeviations: safeParseJson<string[]>(r.scope_deviations_json, []),
					justification: r.justification,
					flagged: Boolean(r.flagged),
					flaggedReason: r.flagged_reason,
					loggedAt: r.logged_at,
				})),
			);

			// Check max iterations
			const runCount = storage.countRunsInSegment(session.id, session.currentSegment);
			if (session.maxIterations !== null && runCount >= session.maxIterations) {
				runtime.autoresearchMode = false;
			}

			// Update autoresearch.md
			await updateAutoresearchMd(directory, runtime.state, args.status, args.description, args.metric);

			// Build result text
			let output = `Run #${runId} logged as ${args.status}.\n`;
			output += `${session.primaryMetric}: ${formatNum(args.metric, session.metricUnit)}\n`;
			if (args.metrics && Object.keys(args.metrics).length > 0) {
				const otherMetrics = Object.entries(args.metrics)
					.map(([k, v]) => `${k}=${v}`)
					.join(", ");
				output += `Other metrics: ${otherMetrics}\n`;
			}
			if (commitHash) {
				output += `Commit: ${commitHash.slice(0, 8)}\n`;
			}
			if (scopeDeviations.length > 0) {
				output += `⚠️ Scope deviations: ${scopeDeviations.join(", ")}\n`;
			}
			if (gitNote) {
				output += `${gitNote}\n`;
			}

			// Show stats
			const baseline = findBaselineMetric(runtime.state.results, session.currentSegment);
			const baselineRun = findBaselineRunNumber(runtime.state.results, session.currentSegment);
			const best = findBestKeptMetric(
				runtime.state.results,
				session.currentSegment,
				session.direction,
			);
			const currentCount = runCount;

			output += `\n--- Stats ---\n`;
			output += `Segment runs: ${currentCount}`;
			if (session.maxIterations) {
				output += ` / ${session.maxIterations}`;
			}
			output += `\n`;
			if (baseline !== null) {
				output += `Baseline: ${formatNum(baseline, session.metricUnit)}`;
				if (baselineRun) output += ` (#${baselineRun})`;
				output += `\n`;
			}
			if (best !== null && baseline !== null && best !== baseline) {
				const delta = ((best - baseline) / baseline) * 100;
				const sign = delta > 0 ? "+" : "";
				output += `Best: ${formatNum(best, session.metricUnit)} (${sign}${delta.toFixed(1)}% vs baseline)\n`;
			}
			if (confidence !== null) {
				output += `Confidence: ${confidence.toFixed(1)}x\n`;
			}

			if (session.maxIterations !== null && runCount >= session.maxIterations) {
				output += `\n🎯 Maximum experiments reached (${session.maxIterations}). Autoresearch mode is now OFF.`;
			}

			return {
				title: "log_experiment",
				output,
				metadata: {
					runId,
					status: args.status,
					metric: args.metric,
					commitHash,
					modifiedPaths,
					scopeDeviations,
					confidence,
					runCount,
					maxIterations: session.maxIterations,
				},
			};
		},
	});
}

/**
 * Safely parses a JSON string, returning a fallback on failure.
 * @param json - JSON string to parse
 * @param fallback - Default value to return on parse error
 * @returns Parsed value or fallback
 */
function safeParseJson<T>(json: string | null, fallback: T): T {
	if (!json) return fallback;
	try {
		return JSON.parse(json) as T;
	} catch {
		return fallback;
	}
}

/**
 * Updates the autoresearch.md file with a new run entry and baseline information.
 * @param directory - Project directory path
 * @param state - Current experiment state
 * @param status - Run status (keep, discard, crash, checks_failed)
 * @param description - Run description
 * @param metric - Primary metric value
 */
async function updateAutoresearchMd(
	directory: string,
	state: import("../types").ExperimentState,
	status: ExperimentStatus,
	description: string,
	metric: number,
): Promise<void> {
	const mdPath = path.join(directory, "autoresearch.md");
	if (!fs.existsSync(mdPath)) return;

	let content = fs.readFileSync(mdPath, "utf-8");

	// Update baseline if this is the first keep
	const isFirstKeep =
		status === "keep" &&
		state.results.filter((r) => r.segment === state.currentSegment && r.status === "keep").length === 0;
	if (isFirstKeep) {
		content = content.replace(/## Baseline\nTBD/, `## Baseline\n${formatNum(metric, state.metricUnit)} (#${state.results.length + 1})`);
	}

	// Add run row
	const runNumber = state.results.length + 1;
	const row = `| ${runNumber} | ${status} | ${formatNum(metric, state.metricUnit)} | ${description} |\n`;
	content = content.trimEnd() + "\n" + row;

	fs.writeFileSync(mdPath, content, "utf-8");
}
