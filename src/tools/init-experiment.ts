/**
 * @file tools/init-experiment.ts
 * @description Provides the init_experiment tool for creating and configuring autoresearch sessions.
 * Handles branch setup, autoresearch.md generation, and session persistence.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import type { AutoresearchStorage } from "../storage";
import type { AutoresearchRuntime } from "../types";
import { dedupeStrings } from "../helpers";
import {
	ensureAutoresearchBranch,
	isAutoresearchBranch,
	gitCommit,
} from "../git";

/**
 * Creates the init_experiment tool for managing experiment initialization.
 * @param storage - AutoresearchStorage instance for persistence
 * @param runtime - AutoresearchRuntime for managing active state
 * @param directory - Project directory path
 * @returns Configured tool instance
 */
export function createInitExperimentTool({
	storage,
	runtime,
	directory,
}: {
	storage: AutoresearchStorage;
	runtime: AutoresearchRuntime;
	directory: string;
}) {
	return tool({
		description: "Initialize a new autoresearch experiment session",
		args: {
			name: z.string().describe("Name of the experiment/benchmark"),
			goal: z
				.string()
				.optional()
				.describe("What are we optimizing for?"),
			primary_metric: z
				.string()
				.describe("The main metric to optimize (e.g., compile_time_ms, bundle_size)"),
			metric_unit: z
				.string()
				.optional()
				.describe("Unit for the metric (e.g., ms, bytes, mb)"),
			direction: z
				.enum(["lower", "higher"])
				.default("lower")
				.describe("Whether lower or higher values are better"),
			scope_paths: z
				.array(z.string())
				.optional()
				.describe("Files/directories the agent may modify"),
			off_limits: z
				.array(z.string())
				.optional()
				.describe("Files/directories the agent must NOT modify"),
			max_iterations: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Maximum number of experiments in this segment"),
			new_segment: z
				.boolean()
				.default(false)
				.describe("Start a new segment (archives previous runs and resets baseline)"),
		},
		execute: async (args) => {
			const harnessPath = path.join(directory, "autoresearch.sh");
			let harnessExists = fs.existsSync(harnessPath);

			// Check if we need to create autoresearch.md
			const autoresearchMdPath = path.join(directory, "autoresearch.md");
			const autoresearchMdExists = fs.existsSync(autoresearchMdPath);

			// Handle branch setup
			const branchResult = await ensureAutoresearchBranch(directory, args.goal ?? null);
			if (!branchResult.ok) {
				return {
					title: "init_experiment",
					output: `Failed to initialize: ${branchResult.error}`,
					metadata: { error: branchResult.error },
				};
			}

			const currentBranch = branchResult.branchName;
			let baselineCommit: string | null = null;

			// If harness exists and we're on an autoresearch branch, commit everything as baseline
			if (harnessExists && currentBranch && isAutoresearchBranch(currentBranch)) {
				const commitMessage = [
					`autoresearch: ${args.name}`,
					"",
					`Benchmark entrypoint: bash autoresearch.sh`,
					`Goal: ${args.goal ?? "optimization"}`,
					`Primary metric: ${args.primary_metric}`,
				].join("\n");
				baselineCommit = await gitCommit(directory, commitMessage, []);
			}

			// Create autoresearch.md if it doesn't exist
			if (!autoresearchMdExists) {
				const mdContent = generateAutoresearchMd({
					name: args.name,
					goal: args.goal ?? null,
					metric: args.primary_metric,
					unit: args.metric_unit ?? "",
					direction: args.direction,
					notes: "",
				});
				fs.writeFileSync(autoresearchMdPath, mdContent, "utf-8");

				// If we just created it and are on autoresearch branch, include it in the baseline commit
				if (currentBranch && isAutoresearchBranch(currentBranch) && !baselineCommit) {
					const commitMessage = [
						`autoresearch: ${args.name}`,
						"",
						`Benchmark entrypoint: bash autoresearch.sh`,
						`Goal: ${args.goal ?? "optimization"}`,
						`Primary metric: ${args.primary_metric}`,
					].join("\n");
					baselineCommit = await gitCommit(directory, commitMessage, ["autoresearch.md"]);
				}
			}

			// If new_segment, close previous session and start fresh
			if (args.new_segment) {
				const activeSession = storage.getActiveSession();
				if (activeSession) {
					storage.closeSession(activeSession.id);
					storage.incrementSegment(activeSession.id);
				}
			}

			// Determine segment
			let segment = 0;
			const activeSession = storage.getActiveSession();
			if (activeSession && !args.new_segment) {
				segment = activeSession.currentSegment;
			}

			// Create session in storage
			const session = storage.insertSession({
				name: args.name,
				goal: args.goal ?? null,
				primaryMetric: args.primary_metric,
				metricUnit: args.metric_unit ?? inferUnit(args.primary_metric),
				direction: args.direction,
				branch: currentBranch,
				baselineCommit,
				scopePaths: dedupeStrings(args.scope_paths ?? []),
				offLimits: dedupeStrings(args.off_limits ?? []),
				constraints: [],
				secondaryMetrics: [],
				notes: "",
				maxIterations: args.max_iterations ?? null,
			});

			// Enable autoresearch mode
			runtime.autoresearchMode = true;
			runtime.goal = args.goal ?? null;
			runtime.state = {
				name: session.name,
				goal: session.goal,
				metricName: session.primaryMetric,
				metricUnit: session.metricUnit,
				bestDirection: session.direction,
				scopePaths: [...session.scopePaths],
				offLimits: [...session.offLimits],
				constraints: [],
				notes: session.notes,
				branch: session.branch,
				baselineCommit: session.baselineCommit,
				sessionId: session.id,
				maxExperiments: session.maxIterations,
				currentSegment: session.currentSegment,
				secondaryMetrics: [],
				results: [],
				bestMetric: null,
				confidence: null,
			};

			let output = `Experiment "${args.name}" initialized.\n`;
			output += `Primary metric: ${args.primary_metric} (${args.direction} is better)\n`;
			if (args.goal) output += `Goal: ${args.goal}\n`;
			if (currentBranch) {
				output += `Branch: ${currentBranch}\n`;
				if (baselineCommit) {
					output += `Baseline commit: ${baselineCommit.slice(0, 8)}\n`;
				}
			} else if (branchResult.warning) {
				output += `Warning: ${branchResult.warning}\n`;
			}
			if (!harnessExists) {
				output += `\n⚠️ autoresearch.sh not found. Create it before running experiments.\n`;
			}
			if (!autoresearchMdExists) {
				output += `Created autoresearch.md to track experiment progress.\n`;
			}
			if (args.max_iterations) {
				output += `Max iterations: ${args.max_iterations}\n`;
			}
			output += `\nAutoresearch mode is now ON. Run the baseline with run_experiment, then log it with log_experiment.`;

			return {
				title: "init_experiment",
				output,
				metadata: {
					sessionId: session.id,
					branch: currentBranch,
					baselineCommit,
					harnessExists,
					autoresearchMdCreated: !autoresearchMdExists,
				},
			};
		},
	});
}

/**
 * Infers a metric unit from the metric name suffix.
 * @param metricName - Name of the metric
 * @returns Inferred unit string
 */
function inferUnit(metricName: string): string {
	if (metricName.endsWith("_ms") || metricName.endsWith("Ms")) return "ms";
	if (metricName.endsWith("_bytes") || metricName.endsWith("Bytes")) return "bytes";
	if (metricName.endsWith("_kb") || metricName.endsWith("KB")) return "KB";
	if (metricName.endsWith("_mb") || metricName.endsWith("MB")) return "MB";
	if (metricName.endsWith("_us") || metricName.endsWith("µs")) return "µs";
	if (metricName.endsWith("_s") || metricName.endsWith("_sec")) return "s";
	return "";
}

/**
 * Generates the initial autoresearch.md markdown content for a new experiment.
 * @param params - Experiment parameters for the markdown template
 * @returns Generated markdown string
 */
function generateAutoresearchMd(params: {
	name: string;
	goal: string | null;
	metric: string;
	unit: string;
	direction: string;
	notes: string;
}): string {
	return `# Autoresearch: ${params.name}

## Goal
${params.goal ?? "TBD"}

## Primary Metric
${params.metric} (${params.unit}, ${params.direction} is better)

## Baseline
TBD

## Notes
${params.notes}

## Runs
| # | Status | Metric | Description |
|---|--------|--------|-------------|
`;
}
