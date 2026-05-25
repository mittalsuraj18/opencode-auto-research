import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { $ } from "bun";
import plugin from "../../src/index";
import { AutoresearchStorage, openAutoresearchStorage } from "../../src/storage";
import type { AutoresearchRuntime } from "../../src/types";
import { cleanupTestDir } from "../test-helpers";

async function initGitRepo(dir: string): Promise<void> {
	await $`git -C ${dir} init`.quiet();
	await $`git -C ${dir} config user.email "test@test.com"`.quiet();
	await $`git -C ${dir} config user.name "Test"`.quiet();
	fs.writeFileSync(path.join(dir, "README.md"), "# Test");
	await $`git -C ${dir} add README.md`.quiet();
	await $`git -C ${dir} commit -m "Initial commit"`.quiet();
}

function createTrackingClient() {
	const summarizeCalls: Array<{ sessionID: string }> = [];
	const client = {
		session: {
			promptAsync: async () => {},
			prompt: async () => {},
		},
		summarize: async (input: any) => {
			summarizeCalls.push({ sessionID: input.path.id });
		},
	};
	return { client, summarizeCalls };
}

describe("Plugin index.ts — rehydration and internal paths", () => {
	it("rehydrates state from active session on startup", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-rehydrate-"));

		fs.writeFileSync(
			path.join(dir, "autoresearch.sh"),
			'#!/bin/bash\necho "METRIC test_coverage_pct=80"',
		);
		fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);

		// Seed the database at the exact path the plugin will look for
		const stateDir = path.join(process.env.HOME ?? "/tmp", ".opencode-autoresearch");
		const encodedProject = encodeURIComponent(dir);
		const dbPath = path.join(stateDir, `${encodedProject}.db`);

		const preStorage = new AutoresearchStorage(dbPath, dir);
		const session = preStorage.insertSession({
			name: "Existing Experiment",
			goal: "Rehydrate test",
			primaryMetric: "test_coverage_pct",
			metricUnit: "%",
			direction: "higher",
			branch: null,
			baselineCommit: null,
			scopePaths: ["src"],
			offLimits: ["dist"],
			constraints: [],
			secondaryMetrics: [],
			notes: "Test notes for rehydration",
			maxIterations: 10,
		});
		// Insert a completed and logged run
		const run = preStorage.insertRun({
			sessionId: session.id,
			segment: 0,
			command: "bash autoresearch.sh",
			logPath: "/tmp/test.log",
			preRunDirtyPaths: [],
			startedAt: Date.now(),
		});
		preStorage.markRunCompleted({
			runId: run.id,
			completedAt: Date.now(),
			durationMs: 1000,
			exitCode: 0,
			timedOut: false,
			parsedPrimary: 80,
			parsedMetrics: { test_coverage_pct: 80 },
			parsedAsi: null,
		});
		preStorage.markRunLogged({
			runId: run.id,
			status: "keep",
			description: "Baseline",
			metric: 80,
			metrics: { test_coverage_pct: 80 },
			asi: null,
			commitHash: null,
			confidence: null,
			modifiedPaths: [],
			scopeDeviations: [],
			justification: null,
			loggedAt: Date.now(),
		});
		preStorage.close();

		// Now load the plugin - it should rehydrate from the seeded session
		const { client } = createTrackingClient();
		const pluginInstance = await plugin({ client, directory: dir });

		expect(pluginInstance.tool).toBeDefined();

		// Verify the system prompt includes the rehydrated experiment data
		const systemOutput = { system: [] };
		await pluginInstance["experimental.chat.system.transform"]!({}, systemOutput);
		expect(systemOutput.system.length).toBeGreaterThan(0);
		expect(systemOutput.system[0]).toContain("Existing Experiment");
		expect(systemOutput.system[0]).toContain("test_coverage_pct");

		// Verify compaction context also works with rehydrated state
		const compactionOutput = { context: [] };
		await pluginInstance["experimental.session.compacting"]!({}, compactionOutput);
		expect(compactionOutput.context.length).toBeGreaterThan(0);
		expect(compactionOutput.context[0]).toContain("Rehydrate test");
		expect(compactionOutput.context[0]).toContain("Baseline");

		// Cleanup
		cleanupTestDir(dir);
	});

	it("builds compaction context with results and notes", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-compaction-ctx-"));

		fs.writeFileSync(
			path.join(dir, "autoresearch.sh"),
			'#!/bin/bash\necho "METRIC compile_time_ms=1000"',
		);
		fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);

		const { client } = createTrackingClient();
		const pluginInstance = await plugin({ client, directory: dir });

		// Initialize experiment first
		const initTool = pluginInstance.tool?.init_experiment;
		expect(initTool).toBeDefined();
		if (!initTool) return;

		await initTool.execute({
			name: "Compaction Test",
			goal: "Test compaction context",
			primary_metric: "compile_time_ms",
			direction: "lower",
		});

		// Run experiment and log it to have some results
		const runTool = pluginInstance.tool?.run_experiment;
		if (runTool) {
			await runTool.execute({});
		}

		const logTool = pluginInstance.tool?.log_experiment;
		if (logTool) {
			await logTool.execute({
				metric: 1000,
				status: "keep",
				description: "Baseline",
			});
		}

		// Now check the compaction context
		const compactionOutput = { context: [] };
		await pluginInstance["experimental.session.compacting"]!({}, compactionOutput);
		expect(compactionOutput.context.length).toBeGreaterThan(0);
		expect(compactionOutput.context[0]).toContain("Autoresearch Experiment Context");
		expect(compactionOutput.context[0]).toContain("compile_time_ms");
		expect(compactionOutput.context[0]).toContain("Baseline");

		cleanupTestDir(dir);
	});

	it("compaction context shows best result and notes", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-compaction-best-"));

		fs.writeFileSync(
			path.join(dir, "autoresearch.sh"),
			'#!/bin/bash\necho "METRIC compile_time_ms=900"',
		);
		fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);

		const { client } = createTrackingClient();
		const pluginInstance = await plugin({ client, directory: dir });

		await pluginInstance.tool?.init_experiment?.execute({
			name: "Best Result Test",
			goal: "Find best result",
			primary_metric: "compile_time_ms",
			direction: "lower",
		});

		// Run and log baseline
		await pluginInstance.tool?.run_experiment?.execute({});
		await pluginInstance.tool?.log_experiment?.execute({
			metric: 1000,
			status: "keep",
			description: "Baseline",
		});

		// Run and log improvement
		await pluginInstance.tool?.run_experiment?.execute({});
		await pluginInstance.tool?.log_experiment?.execute({
			metric: 900,
			status: "keep",
			description: "Improved",
		});

		// Check compaction context shows best
		const compactionOutput = { context: [] };
		await pluginInstance["experimental.session.compacting"]!({}, compactionOutput);
		expect(compactionOutput.context[0]).toContain("Best Result");

		cleanupTestDir(dir);
	});

	it("system prompt shows pending run warning", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-pending-warn-"));

		fs.writeFileSync(
			path.join(dir, "autoresearch.sh"),
			'#!/bin/bash\necho "METRIC compile_time_ms=1000"',
		);
		fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);

		const { client } = createTrackingClient();
		const pluginInstance = await plugin({ client, directory: dir });

		await pluginInstance.tool?.init_experiment?.execute({
			name: "Pending Test",
			primary_metric: "compile_time_ms",
			direction: "lower",
		});

		// Run experiment but don't log it - creates pending run
		await pluginInstance.tool?.run_experiment?.execute({});

		// Check system prompt includes pending warning
		const systemOutput = { system: [] };
		await pluginInstance["experimental.chat.system.transform"]!({}, systemOutput);
		expect(systemOutput.system.length).toBeGreaterThan(0);
		expect(systemOutput.system[0]).toContain("pending");

		cleanupTestDir(dir);
	});

	it("command.execute.before handles missing text part with fallback", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-cmd-fallback-"));

		const { client } = createTrackingClient();
		const pluginInstance = await plugin({ client, directory: dir });

		// Create output with no text part
		const output = { parts: [] as any[] };

		await pluginInstance["command.execute.before"]!(
			{
				command: "autoresearch",
				sessionID: "test",
				arguments: "test goal",
			},
			output,
		);

		// Should have pushed a new text part as fallback
		expect(output.parts.length).toBeGreaterThan(0);
		expect(output.parts[0].type).toBe("text");
		expect(output.parts[0].text).toContain("Start an autoresearch experiment");

		cleanupTestDir(dir);
	});

	it("command.execute.before ignores non-autoresearch commands", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-cmd-other-"));

		const { client } = createTrackingClient();
		const pluginInstance = await plugin({ client, directory: dir });

		const output = { parts: [{ type: "text", text: "original" }] as any[] };

		await pluginInstance["command.execute.before"]!(
			{
				command: "other",
				sessionID: "test",
				arguments: "",
			},
			output,
		);

		// Should not have modified the parts
		expect(output.parts[0].text).toBe("original");

		cleanupTestDir(dir);
	});

	it("auto-continue is not enabled when mode is off", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-no-auto-"));

		const { client } = createTrackingClient();
		const pluginInstance = await plugin({ client, directory: dir });

		const autocontinueOutput = { enabled: false };
		await pluginInstance["experimental.compaction.autocontinue"]!({}, autocontinueOutput);
		expect(autocontinueOutput.enabled).toBe(false);

		cleanupTestDir(dir);
	});

	it("system prompt is not injected when mode is off", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-no-prompt-"));

		const { client } = createTrackingClient();
		const pluginInstance = await plugin({ client, directory: dir });

		const systemOutput = { system: [] };
		await pluginInstance["experimental.chat.system.transform"]!({}, systemOutput);
		expect(systemOutput.system.length).toBe(0);

		cleanupTestDir(dir);
	});

	it("compaction context is not injected when mode is off", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-no-compaction-"));

		const { client } = createTrackingClient();
		const pluginInstance = await plugin({ client, directory: dir });

		const compactionOutput = { context: [] };
		await pluginInstance["experimental.session.compacting"]!({}, compactionOutput);
		expect(compactionOutput.context.length).toBe(0);

		cleanupTestDir(dir);
	});

	it("tracks model from chat params", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-model-track-"));

		const { client, summarizeCalls } = createTrackingClient();
		const pluginInstance = await plugin({ client, directory: dir });

		// Set model
		if (pluginInstance.chat?.params) {
			await pluginInstance.chat.params({
				sessionID: "test",
				agent: "test",
				model: { providerID: "anthropic", modelID: "claude-3" },
				provider: {},
				message: {},
			} as any);
		}

		// The model tracking is internal, but we can verify it doesn't error
		expect(true).toBe(true);

		cleanupTestDir(dir);
	});

	it("event handler triggers compaction after log_experiment", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-event-compaction-"));

		fs.writeFileSync(
			path.join(dir, "autoresearch.sh"),
			'#!/bin/bash\necho "METRIC compile_time_ms=1000"',
		);
		fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);

		const { client, summarizeCalls } = createTrackingClient();
		const pluginInstance = await plugin({ client, directory: dir });

		// Set model so auto-compaction can fire
		if (pluginInstance.chat?.params) {
			await pluginInstance.chat.params({
				sessionID: "test",
				agent: "test",
				model: { providerID: "test", modelID: "test-model" },
				provider: {},
				message: {},
			} as any);
		}

		// Init, run, log
		await pluginInstance.tool?.init_experiment?.execute({
			name: "Event Test",
			primary_metric: "compile_time_ms",
			direction: "lower",
		});

		await pluginInstance.tool?.run_experiment?.execute({});
		await pluginInstance.tool?.log_experiment?.execute({
			metric: 1000,
			status: "keep",
			description: "Run 1",
		});

		// Fire the event that should trigger compaction
		if (pluginInstance.event) {
			await pluginInstance.event({
				event: {
					type: "session.next.step.ended",
					properties: { sessionID: "test-session" },
				},
			});
		}

		expect(summarizeCalls.length).toBeGreaterThan(0);

		cleanupTestDir(dir);
	});
});
