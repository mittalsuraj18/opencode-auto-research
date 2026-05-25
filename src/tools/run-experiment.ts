// tools/run-experiment.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import type { AutoresearchRuntime } from "../types";
import type { AutoresearchStorage } from "../storage";
import {
	parseBenchmarkOutput,
	tryGitPrefix,
	tryGitStatus,
	truncateOutput,
	computeRunModifiedPaths,
} from "../helpers";

export function createRunExperimentTool({
	storage,
	runtime,
	directory,
}: {
	storage: AutoresearchStorage;
	runtime: AutoresearchRuntime;
	directory: string;
}) {
	return tool({
		description: "Run the benchmark harness (bash autoresearch.sh) and capture results",
		args: {
			timeout_seconds: z
				.number()
				.int()
				.positive()
				.default(600)
				.describe("Maximum time to wait for the benchmark (seconds)"),
		},
		execute: async (args) => {
			// Check if there's a pending run that hasn't been logged
			if (runtime.lastRunSummary && !runtime.justLoggedExperiment) {
				return {
					title: "run_experiment",
					output: `⚠️ Run #${runtime.lastRunSummary.runNumber} is pending. Call log_experiment before starting a new run.`,
					metadata: { pendingRun: runtime.lastRunSummary.runNumber },
				};
			}

			const harnessPath = path.join(directory, "autoresearch.sh");
			if (!fs.existsSync(harnessPath)) {
				return {
					title: "run_experiment",
					output: `autoresearch.sh not found at ${harnessPath}. Create it first.`,
					metadata: { error: "harness_missing" },
				};
			}

			const session = storage.getActiveSession();
			if (!session) {
				return {
					title: "run_experiment",
					output: "No active experiment session. Call init_experiment first.",
					metadata: { error: "no_session" },
				};
			}

			// Record pre-run dirty paths
			const preRunStatus = await tryGitStatus(directory);
			const workDirPrefix = await tryGitPrefix(directory);
			const preRunDirtyPaths = preRunStatus
				? (await import("../helpers")).parseWorkDirDirtyPaths(preRunStatus, workDirPrefix)
				: [];

			// Create run directory for logs
			const stateDir = path.join(
				process.env.HOME ?? "/tmp",
				".opencode-autoresearch",
				encodeURIComponent(directory),
				"runs",
			);
			const nextRunNumber = (() => {
				const runs = storage.getRunsForSession(session.id);
				const maxId = runs.reduce((max, r) => Math.max(max, r.id), 0);
				return maxId + 1;
			})();
			const runLogDir = path.join(stateDir, String(nextRunNumber));
			fs.mkdirSync(runLogDir, { recursive: true });
			const logPath = path.join(runLogDir, "benchmark.log");

			// Insert pending run
			const runRecord = storage.insertRun({
				sessionId: session.id,
				segment: session.currentSegment,
				command: "bash autoresearch.sh",
				logPath,
				preRunDirtyPaths,
				startedAt: Date.now(),
			});

			// Track running experiment
			const startedAt = Date.now();
			runtime.runningExperiment = {
				startedAt,
				command: "bash autoresearch.sh",
				runNumber: runRecord.id,
			};

			// Execute benchmark
			let output = "";
			let exitCode: number | null = null;
			let timedOut = false;

			try {
				const proc = Bun.spawn(["bash", "autoresearch.sh"], {
					cwd: directory,
					timeout: args.timeout_seconds * 1000,
					stdio: ["ignore", "pipe", "pipe"],
				});

				const stdout = await new Response(proc.stdout).text();
				const stderr = await new Response(proc.stderr).text();
				output = stdout + (stderr ? "\n" + stderr : "");
				exitCode = proc.exitCode;

				if (exitCode === null) {
					timedOut = true;
					exitCode = -1;
					try {
						proc.kill();
					} catch {
						// ignore
					}
				}
			} catch (err) {
				output = `Execution error: ${err instanceof Error ? err.message : String(err)}`;
				exitCode = -1;
			}

			const completedAt = Date.now();
			const durationMs = completedAt - startedAt;

			// Save raw output to disk
			fs.writeFileSync(logPath, output, "utf-8");

			// Parse metrics
			const parsed = parseBenchmarkOutput(output, session.primaryMetric);

			// Mark run completed
			storage.markRunCompleted({
				runId: runRecord.id,
				completedAt,
				durationMs,
				exitCode,
				timedOut,
				parsedPrimary: parsed.primaryMetric,
				parsedMetrics: parsed.metrics,
				parsedAsi: parsed.asi,
			});

			// Compute modified paths
			const postRunStatus = await tryGitStatus(directory);
			let modifiedPaths: string[] = [];
			if (postRunStatus) {
				const { tracked, untracked } = computeRunModifiedPaths(
					preRunDirtyPaths,
					postRunStatus,
					workDirPrefix,
				);
				modifiedPaths = [...tracked, ...untracked];
			}

			// Update runtime
			runtime.runningExperiment = null;
			runtime.lastRunSummary = {
				runNumber: runRecord.id,
				passed: exitCode === 0 && !timedOut,
				parsedPrimary: parsed.primaryMetric,
			};
			runtime.justLoggedExperiment = false;

			// Build output
			const passed = exitCode === 0 && !timedOut;
			let resultText = `Run #${runRecord.id} ${passed ? "passed" : "failed"} in ${(durationMs / 1000).toFixed(1)}s`;
			if (timedOut) {
				resultText += " (timed out)";
			}
			if (parsed.primaryMetric !== null) {
				resultText += `\n${session.primaryMetric} = ${parsed.primaryMetric}`;
			}
			if (Object.keys(parsed.metrics).length > 0) {
				const otherMetrics = Object.entries(parsed.metrics)
					.filter(([k]) => k !== session.primaryMetric)
					.map(([k, v]) => `${k}=${v}`)
					.join(", ");
				if (otherMetrics) {
					resultText += `\nOther metrics: ${otherMetrics}`;
				}
			}
			if (Object.keys(parsed.asi).length > 0) {
				const asiSummary = Object.entries(parsed.asi)
					.map(([k, v]) => `${k}=${v}`)
					.join(", ");
				resultText += `\nASI: ${asiSummary}`;
			}
			if (modifiedPaths.length > 0) {
				resultText += `\nModified files: ${modifiedPaths.slice(0, 5).join(", ")}`;
				if (modifiedPaths.length > 5) {
					resultText += ` (+${modifiedPaths.length - 5} more)`;
				}
			}

			const truncated = truncateOutput(output, 4000, 10);
			resultText += `\n\n--- Output (truncated) ---\n${truncated}`;

			return {
				title: "run_experiment",
				output: resultText,
				metadata: {
					runId: runRecord.id,
					passed,
					timedOut,
					exitCode,
					durationMs,
					primaryMetric: parsed.primaryMetric,
					metrics: parsed.metrics,
					asi: parsed.asi,
					modifiedPaths,
					logPath,
				},
			};
		},
	});
}
