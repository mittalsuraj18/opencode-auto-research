// index.ts
// Plugin entry point for opencode-auto-research.

import * as fs from "node:fs";
import * as path from "node:path";
import type { Plugin } from "@opencode-ai/plugin";
import { openAutoresearchStorage } from "./storage";
import { createRuntimeStore, buildExperimentState } from "./state";
import { getCurrentBranch } from "./git";
import { formatNum } from "./helpers";
import { createInitExperimentTool } from "./tools/init-experiment";
import { createRunExperimentTool } from "./tools/run-experiment";
import { createLogExperimentTool } from "./tools/log-experiment";
import { createUpdateNotesTool } from "./tools/update-notes";

export default (async ({ client, directory }) => {
	const storage = openAutoresearchStorage(directory);
	const runtimeStore = createRuntimeStore();

	const getSessionKey = (): string => directory;
	const getRuntime = (): import("./types").AutoresearchRuntime =>
		runtimeStore.ensure(getSessionKey());

	const loadActiveSession = async (): Promise<{
		session: import("./types").SessionRow | null;
		currentBranch: string | null;
	}> => {
		const currentBranch = await getCurrentBranch(directory);
		const session = storage.getActiveSessionForBranch(currentBranch);
		return { session, currentBranch };
	};

	const runtime = getRuntime();

	// Rehydrate on startup
	const { session } = await loadActiveSession();
	if (session) {
		const runs = storage.getRunsForSession(session.id);
		runtime.state = buildExperimentState(
			session,
			runs.map((r) => ({
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
		runtime.autoresearchMode = true;
		runtime.goal = session.goal;
	}

	const initExperimentTool = createInitExperimentTool({ storage, runtime, directory });
	const runExperimentTool = createRunExperimentTool({ storage, runtime, directory });
	const logExperimentTool = createLogExperimentTool({ storage, runtime, directory, client });
	const updateNotesTool = createUpdateNotesTool({ storage, runtime, directory });

	// Read prompt templates
	const systemPromptPath = path.join(__dirname, "..", "src", "prompts", "system.md");
	const setupPromptPath = path.join(__dirname, "..", "src", "prompts", "setup.md");
	const systemPromptTemplate = fs.existsSync(systemPromptPath)
		? fs.readFileSync(systemPromptPath, "utf-8")
		: "";
	const setupPromptTemplate = fs.existsSync(setupPromptPath)
		? fs.readFileSync(setupPromptPath, "utf-8")
		: "";

	// Helper to send synthetic user prompt via client
	const sendUserPrompt = async (sessionID: string, text: string): Promise<void> => {
		if (!client) return;
		const c = client as any;
		const input = {
			path: { id: sessionID },
			body: {
				parts: [{ type: "text", text }],
			},
		};
		try {
			if (typeof c.session?.promptAsync === "function") {
				await c.session.promptAsync(input);
			} else if (typeof c.session?.prompt === "function") {
				await Promise.resolve(c.session.prompt(input));
			} else if (typeof c.prompt === "function") {
				await Promise.resolve(c.prompt(input));
			}
		} catch (err) {
			console.error("Failed to send user prompt:", err);
		}
	};

	return {
		tool: {
			init_experiment: initExperimentTool,
			run_experiment: runExperimentTool,
			log_experiment: logExperimentTool,
			update_notes: updateNotesTool,
		},

		// Register /autoresearch command for autocomplete
		config: async (config) => {
			config.command = {
				...config.command,
				autoresearch: {
					template: "autoresearch",
					description: "Start or resume an autoresearch experiment",
				},
			};
		},

		// Handle /autoresearch command execution
		"command.execute.before": async (input) => {
			if (input.command !== "autoresearch") return;

			const goal = input.arguments.trim();
			const sessionID = input.sessionID;
			const currentRuntime = getRuntime();

			if (currentRuntime.autoresearchMode && currentRuntime.state.sessionId > 0) {
				// Resume existing experiment
				const prompt = goal
					? `Continue autoresearch experiment "${currentRuntime.state.name}". New goal: ${goal}. Run the next experiment.`
					: `Continue autoresearch experiment "${currentRuntime.state.name}". Run the next experiment.`;
				await sendUserPrompt(sessionID, prompt);
			} else {
				// Start new experiment
				const prompt = goal
					? `Start an autoresearch experiment. Goal: ${goal}. Create autoresearch.sh if missing. Call init_experiment with appropriate benchmark name and metric. Run baseline, log it as keep, then continue optimizing.`
					: "Start an autoresearch experiment. Create autoresearch.sh if missing. Call init_experiment with appropriate benchmark name and metric. Run baseline, log it as keep, then continue optimizing.";
				await sendUserPrompt(sessionID, prompt);
			}

			// Prevent the raw command from being forwarded to the LLM
			throw new Error("__AUTORESEARCH_HANDLED__");
		},

		// Track current model for compaction
		chat: {
			params: async (input: {
				sessionID: string;
				agent: string;
				model: { providerID: string; modelID: string };
				provider: unknown;
				message: unknown;
			}) => {
				if (input.model) {
					runtime.currentModel = {
						providerID: input.model.providerID,
						modelID: input.model.modelID,
					};
				}
			},
		},

		// Inject autoresearch system prompt when active
		"experimental.chat.system.transform": async (input, output) => {
			if (!runtime.autoresearchMode) return;
			const { session: activeSession } = await loadActiveSession();
			if (!activeSession) return;

			const prompt = buildSystemPrompt(runtime, systemPromptTemplate);
			output.system.push(prompt);
		},

		// Inject experiment state into compaction prompt
		"experimental.session.compacting": async (input, output) => {
			if (!runtime.autoresearchMode) return;
			const { session: activeSession } = await loadActiveSession();
			if (!activeSession) return;

			const compactionContext = buildCompactionContext(runtime);
			output.context.push(compactionContext);
		},

		// Enable auto-continue after compaction when in autoresearch mode
		"experimental.compaction.autocontinue": async (input, output) => {
			if (!runtime.autoresearchMode) return;
			output.enabled = true;
		},

		// Event handling for auto-compaction
		event: async ({ event }) => {
			if ((event as any).type === "session.next.step.ended") {
				// Check if we just logged an experiment and need to compact
				if (runtime.justLoggedExperiment) {
					runtime.justLoggedExperiment = false;

					// Trigger compaction
					if (runtime.currentModel && client) {
						try {
							const sessionID = (event as any).properties?.sessionID;
							if (sessionID) {
								await (client as any).summarize({
									path: { id: sessionID },
								});
							}
						} catch (err) {
							// Compaction errors are non-fatal
							console.error("Auto-compaction failed:", err);
						}
					}
				}
			}
		},
	};
}) satisfies Plugin;

function buildSystemPrompt(
	runtime: import("./types").AutoresearchRuntime,
	template: string,
): string {
	const state = runtime.state;
	const current = state.results.filter((r) => r.segment === state.currentSegment);
	const recentResults = current.slice(-3);

	let prompt = template || defaultSystemPrompt();

	// Simple template substitution
	prompt = prompt.replace(/\{\{state\.name\}\}/g, state.name || "Unnamed");
	prompt = prompt.replace(/\{\{state\.goal\}\}/g, state.goal || "Not set");
	prompt = prompt.replace(/\{\{state\.metricName\}\}/g, state.metricName || "metric");
	prompt = prompt.replace(/\{\{state\.metricUnit\}\}/g, state.metricUnit || "");
	prompt = prompt.replace(/\{\{state\.bestDirection\}\}/g, state.bestDirection);
	prompt = prompt.replace(/\{\{state\.bestMetric\}\}/g, formatNum(state.bestMetric, state.metricUnit));
	prompt = prompt.replace(/\{\{state\.confidence\}\}/g, state.confidence?.toFixed(1) ?? "N/A");
	prompt = prompt.replace(/\{\{state\.maxExperiments\}\}/g, String(state.maxExperiments ?? "unlimited"));
	prompt = prompt.replace(/\{\{state\.notes\}\}/g, state.notes || "None");

	// Recent results
	const recentResultsText = recentResults
		.map(
			(r) =>
				`- Run #${r.runNumber}: ${r.status} | ${state.metricName}=${formatNum(r.metric, state.metricUnit)} | ${r.description}`,
		)
		.join("\n");
	prompt = prompt.replace(/\{\{#each recentResults\}\}[\s\S]*?\{\{\/each\}\}/g, recentResultsText || "No runs yet.");

	// Pending run warning
	if (runtime.lastRunSummary) {
		prompt += `\n\n⚠️ IMPORTANT: Run #${runtime.lastRunSummary.runNumber} is pending. You MUST call log_experiment before starting a new run_experiment.`;
	}

	return prompt;
}

function buildCompactionContext(runtime: import("./types").AutoresearchRuntime): string {
	const state = runtime.state;
	const current = state.results.filter((r) => r.segment === state.currentSegment);
	const kept = current.filter((r) => r.status === "keep");
	const best = kept.reduce<{ metric: number; runNumber: number } | null>((acc, r) => {
		if (!acc || (state.bestDirection === "lower" ? r.metric < acc.metric : r.metric > acc.metric)) {
			return { metric: r.metric, runNumber: r.runNumber };
		}
		return acc;
	}, null);

	let context = `## Autoresearch Experiment Context\n\n`;
	context += `**Goal:** ${state.goal || "Not set"}\n`;
	context += `**Metric:** ${state.metricName} (${state.bestDirection} is better)\n`;
	context += `**Baseline:** ${formatNum(state.bestMetric, state.metricUnit)}\n`;
	if (best) {
		context += `**Best Result:** ${formatNum(best.metric, state.metricUnit)} (Run #${best.runNumber})\n`;
	}
	context += `**Total Runs:** ${current.length}\n`;
	context += `**Kept Runs:** ${kept.length}\n`;
	if (state.notes) {
		context += `\n**Notes:**\n${state.notes}\n`;
	}

	return context;
}

function defaultSystemPrompt(): string {
	return `# Autoresearch System Prompt

You are in an autonomous experiment loop. Your goal is to optimize the project's performance through systematic experimentation.

## Current Experiment State
**Experiment:** {{state.name}}
**Goal:** {{state.goal}}
**Primary Metric:** {{state.metricName}} ({{state.metricUnit}}, {{state.bestDirection}} is better)
**Baseline:** {{state.bestMetric}}
**Confidence:** {{state.confidence}}
**Max Iterations:** {{state.maxExperiments}}

## Recent Results
{{#each recentResults}}
- Run details here
{{/each}}

## Notes
{{state.notes}}

## Instructions
1. You are in an autonomous loop. After every tool call, analyze the result and immediately take the next step.
2. Do not stop and wait for the user. Keep iterating until the goal is achieved or max iterations reached.
3. If a run is pending (run_experiment completed but not logged), you MUST call log_experiment before starting a new run.
4. Preserve correctness. Do not game the benchmark.
5. If you hit a dead end, try a different approach.
6. After log_experiment, the conversation will be compacted automatically. Continue from the most promising direction.
`;
}

function safeParseJson<T>(json: string | null, fallback: T): T {
	if (!json) return fallback;
	try {
		return JSON.parse(json) as T;
	} catch {
		return fallback;
	}
}
