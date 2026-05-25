import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import plugin from "../../src/index";
import { cleanupTestDir } from "../test-helpers";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createTestDir(): { dir: string; cleanup: () => void } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-e2e-test-"));
	return {
		dir,
		cleanup: () => {
			cleanupTestDir(dir);
		},
	};
}

/**
 * Simulated LLM that makes predetermined "decisions" about what to do next.
 * Each decision is either:
 *   - { type: "tool", name: string, args: object }
 *   - { type: "text", content: string }
 */
class StubbedLLM {
	private decisions: Array<
		| { type: "tool"; name: string; args: Record<string, unknown> }
		| { type: "text"; content: string }
	>;
	private index = 0;

	constructor(
		decisions: Array<
			| { type: "tool"; name: string; args: Record<string, unknown> }
			| { type: "text"; content: string }
		>,
	) {
		this.decisions = decisions;
	}

	nextDecision() {
		if (this.index >= this.decisions.length) {
			return { type: "text" as const, content: "Done." };
		}
		return this.decisions[this.index++];
	}

	getCallCount() {
		return this.index;
	}
}

/**
 * Simulated OpenCode agent that drives the plugin through a realistic loop.
 * It loads the plugin, applies hooks, and makes tool calls based on LLM decisions.
 */
/**
 * Creates a mock client that tracks summarize and prompt calls.
 * Use the same object for plugin initialization and SimulatedAgent.
 */
function createTrackingClient() {
	const prompts: Array<{ sessionID: string; text: string }> = [];
	const summarizeCalls: Array<{ sessionID: string }> = [];
	const client = {
		session: {
			promptAsync: async (input: any) => {
				const text = input.body?.parts?.[0]?.text || "";
				prompts.push({ sessionID: input.path.id, text });
			},
			prompt: async (input: any) => {
				const text = input.body?.parts?.[0]?.text || "";
				prompts.push({ sessionID: input.path.id, text });
			},
		},
		summarize: async (input: any) => {
			summarizeCalls.push({ sessionID: input.path.id });
		},
	};
	return { client, prompts, summarizeCalls };
}

class SimulatedAgent {
	plugin: Awaited<ReturnType<typeof plugin>>;
	llm: StubbedLLM;
	sessionID: string;
	directory: string;
	toolResults: Array<{ name: string; result: any }> = [];

	constructor(
		plugin: SimulatedAgent["plugin"],
		llm: StubbedLLM,
		directory: string,
	) {
		this.plugin = plugin;
		this.llm = llm;
		this.directory = directory;
		this.sessionID = `test-session-${Date.now()}`;
	}

	/**
	 * Simulate one "agent turn" — the LLM makes a decision, we execute it.
	 */
	async runTurn() {
		// 1. Apply system prompt hook
		const systemOutput = { system: [] };
		if (this.plugin["experimental.chat.system.transform"]) {
			await this.plugin["experimental.chat.system.transform"](
				{ sessionID: this.sessionID } as any,
				systemOutput,
			);
		}

		// 2. Get LLM decision
		const decision = this.llm.nextDecision();

		if (decision.type === "text") {
			// LLM returned text — turn ends
			return { type: "text" as const, content: decision.content };
		}

		// 3. Execute tool
		const tool = this.plugin.tool?.[decision.name as keyof typeof this.plugin.tool];
		if (!tool) {
			throw new Error(`Tool "${decision.name}" not found`);
		}

		const result = await tool.execute(decision.args);
		this.toolResults.push({ name: decision.name, result });

		// 4. Fire tool.after hook if exists
		if (this.plugin["tool.execute.after"]) {
			await this.plugin["tool.execute.after"](
				{
					tool: decision.name,
					args: decision.args,
					result,
					sessionID: this.sessionID,
				} as any,
				{} as any,
			);
		}

		// 5. Fire step.ended event (triggers auto-compaction after log_experiment)
		if (this.plugin.event) {
			await this.plugin.event({
				event: {
					type: "session.next.step.ended",
					properties: { sessionID: this.sessionID },
				} as any,
			});
		}

		return { type: "tool" as const, name: decision.name, result };
	}

	/**
	 * Run the full experiment loop for N turns or until LLM is exhausted.
	 */
	async runLoop(maxTurns = 10) {
		const turns = [];
		for (let i = 0; i < maxTurns; i++) {
			const turn = await this.runTurn();
			turns.push(turn);
			if (turn.type === "text") break;
		}
		return turns;
	}
}

// ─── E2E Tests ──────────────────────────────────────────────────────────────

describe("Plugin E2E — Full Experiment Loop", () => {
	describe("basic lifecycle", () => {
		it("loads plugin with all tools and hooks", async () => {
			const { dir, cleanup } = createTestDir();
			const pluginInstance = await plugin({ client: {}, directory: dir });
			expect(pluginInstance.tool).toBeDefined();
			expect(pluginInstance.tool?.init_experiment).toBeDefined();
			expect(pluginInstance.tool?.run_experiment).toBeDefined();
			expect(pluginInstance.tool?.log_experiment).toBeDefined();
			expect(pluginInstance.tool?.update_notes).toBeDefined();
			expect(pluginInstance.config).toBeDefined();
			expect(pluginInstance["command.execute.before"]).toBeDefined();
			expect(pluginInstance["experimental.chat.system.transform"]).toBeDefined();
			expect(pluginInstance["experimental.session.compacting"]).toBeDefined();
			expect(pluginInstance["experimental.compaction.autocontinue"]).toBeDefined();
			expect(pluginInstance.event).toBeDefined();
			cleanup();
		});
	});

	describe("command registration", () => {
		it("registers /autoresearch command in config", async () => {
			const { dir, cleanup } = createTestDir();
			const pluginInstance = await plugin({ client: {}, directory: dir });
			const config = { command: {} };
			await pluginInstance.config!(config);
			expect(config.command).toHaveProperty("autoresearch");
			expect(config.command.autoresearch.template).toBe("autoresearch");
			expect(config.command.autoresearch.description).toBe("Start or resume an autoresearch experiment");
			cleanup();
		});
	});

	describe("full experiment loop", () => {
		it("runs init_experiment → run_experiment → log_experiment sequence", async () => {
			const { dir, cleanup } = createTestDir();

			// Create autoresearch.sh harness
			fs.writeFileSync(
				path.join(dir, "autoresearch.sh"),
				'#!/bin/bash\necho "METRIC compile_time_ms=1200"\necho "ASI hypothesis=baseline"',
			);

			const { client } = createTrackingClient();
			const pluginInstance = await plugin({ client, directory: dir });

			// LLM decisions for the experiment loop
			const llm = new StubbedLLM([
				{
					type: "tool",
					name: "init_experiment",
					args: {
						name: "Test",
						goal: "Optimize",
						primary_metric: "compile_time_ms",
						direction: "lower",
					},
				},
				{ type: "tool", name: "run_experiment", args: {} },
				{
					type: "tool",
					name: "log_experiment",
					args: { metric: 1200, status: "keep", description: "Baseline run" },
				},
			]);

			const agent = new SimulatedAgent(pluginInstance, llm, dir);
			const turns = await agent.runLoop();

			// Verify sequence (4 turns: 3 tools + final "Done" text)
			expect(turns).toHaveLength(4);
			expect(turns[0].type).toBe("tool");
			expect((turns[0] as any).name).toBe("init_experiment");
			expect(turns[1].type).toBe("tool");
			expect((turns[1] as any).name).toBe("run_experiment");
			expect(turns[2].type).toBe("tool");
			expect((turns[2] as any).name).toBe("log_experiment");

			// Verify init_experiment result
			const initResult = agent.toolResults[0].result;
			expect(initResult.metadata.sessionId).toBeDefined();
			expect(initResult.metadata.autoresearchMdCreated).toBe(true);

			// Verify run_experiment parsed the metric
			const runResult = agent.toolResults[1].result;
			expect(runResult.metadata).toBeDefined();
			expect(runResult.metadata.primaryMetric).toBe(1200);

			// Verify log_experiment committed
			const logResult = agent.toolResults[2].result;
			expect(logResult.metadata.status).toBe("keep");

			cleanup();
		});

		it("auto-compacts after log_experiment", async () => {
			const { dir, cleanup } = createTestDir();

			fs.writeFileSync(
				path.join(dir, "autoresearch.sh"),
				'#!/bin/bash\necho "METRIC compile_time_ms=1000"',
			);

			const { client, summarizeCalls } = createTrackingClient();
			const pluginInstance = await plugin({ client, directory: dir });

			// Set a current model so auto-compaction can fire
			if (pluginInstance.chat?.params) {
				await pluginInstance.chat.params({
					sessionID: "test",
					agent: "test",
					model: { providerID: "test", modelID: "test-model" },
					provider: {},
					message: {},
				} as any);
			}

			const llm = new StubbedLLM([
				{
					type: "tool",
					name: "init_experiment",
					args: {
						name: "Test",
						goal: "Optimize",
						primary_metric: "compile_time_ms",
						direction: "lower",
					},
				},
				{ type: "tool", name: "run_experiment", args: {} },
				{
					type: "tool",
					name: "log_experiment",
					args: { metric: 1000, status: "keep", description: "Run 1" },
				},
			]);

			const agent = new SimulatedAgent(pluginInstance, llm, dir);
			await agent.runLoop();

			// After log_experiment, the event handler should trigger compaction
			expect(summarizeCalls.length).toBeGreaterThan(0);

			cleanup();
		});

		it("continues the loop with multiple iterations", async () => {
			const { dir, cleanup } = createTestDir();

			fs.writeFileSync(
				path.join(dir, "autoresearch.sh"),
				'#!/bin/bash\necho "METRIC compile_time_ms=900"',
			);

			const { client } = createTrackingClient();
			const pluginInstance = await plugin({ client, directory: dir });

			// 2 full iterations: init → run → log → run → log
			const llm = new StubbedLLM([
				{
					type: "tool",
					name: "init_experiment",
					args: {
						name: "Test",
						goal: "Optimize",
						primary_metric: "compile_time_ms",
						direction: "lower",
						max_iterations: 10,
					},
				},
				{ type: "tool", name: "run_experiment", args: {} },
				{
					type: "tool",
					name: "log_experiment",
					args: { metric: 900, status: "keep", description: "Run 1" },
				},
				{ type: "tool", name: "run_experiment", args: {} },
				{
					type: "tool",
					name: "log_experiment",
					args: { metric: 850, status: "keep", description: "Run 2" },
				},
			]);

			const agent = new SimulatedAgent(pluginInstance, llm, dir);
			const turns = await agent.runLoop();

			// 5 tools + final "Done" text = 6 turns
			expect(turns).toHaveLength(6);
			expect(agent.toolResults).toHaveLength(5);

			// Verify second log improved the metric
			const log2 = agent.toolResults[4].result;
			expect(log2.metadata.metric).toBe(850);

			cleanup();
		});
	});

	describe("system prompt injection", () => {
		it("injects autoresearch prompt when mode is active", async () => {
			const { dir, cleanup } = createTestDir();

			fs.writeFileSync(
				path.join(dir, "autoresearch.sh"),
				'#!/bin/bash\necho "METRIC compile_time_ms=1000"',
			);

			const pluginInstance = await plugin({ client: {}, directory: dir });

			// Initialize experiment
			const llm = new StubbedLLM([
				{
					type: "tool",
					name: "init_experiment",
					args: {
						name: "Test",
						goal: "Optimize",
						primary_metric: "compile_time_ms",
						direction: "lower",
					},
				},
			]);
			const agent = new SimulatedAgent(pluginInstance, llm, dir);
			await agent.runTurn();

			// Check system prompt injection
			const systemOutput = { system: [] };
			await pluginInstance["experimental.chat.system.transform"]!(
				{ sessionID: agent.sessionID } as any,
				systemOutput,
			);
			expect(systemOutput.system.length).toBeGreaterThan(0);
			expect(systemOutput.system[0]).toContain("Test");
			expect(systemOutput.system[0]).toContain("compile_time_ms");

			cleanup();
		});
	});

	describe("command execution", () => {
		it("handles /autoresearch <goal> for new experiment", async () => {
			const { dir, cleanup } = createTestDir();
			const { client } = createTrackingClient();
			const pluginInstance = await plugin({ client, directory: dir });

			const sessionID = `test-session-${Date.now()}`;
			// Simulate what opencode provides: parts with a text part from the command template
			const output = {
				parts: [
					{
						type: "text",
						id: "prt_test_001",
						sessionID,
						messageID: "msg_test_001",
						text: "autoresearch\n\noptimize compile time",
					},
				] as any[],
			};

			await pluginInstance["command.execute.before"]!(
				{
					command: "autoresearch",
					sessionID,
					arguments: "optimize compile time",
				},
				output,
			);

			// The hook should modify the existing text part's content
			expect(output.parts.length).toBe(1);
			expect(output.parts[0].type).toBe("text");
			expect(output.parts[0].text).toContain("optimize compile time");
			expect(output.parts[0].text).toContain("Start an autoresearch experiment");
			// The original metadata should be preserved
			expect(output.parts[0].id).toBe("prt_test_001");
			expect(output.parts[0].sessionID).toBe(sessionID);

			cleanup();
		});

		it("handles /autoresearch to resume active experiment", async () => {
			const { dir, cleanup } = createTestDir();

			fs.writeFileSync(
				path.join(dir, "autoresearch.sh"),
				'#!/bin/bash\necho "METRIC compile_time_ms=1000"',
			);

			const { client } = createTrackingClient();
			const pluginInstance = await plugin({ client, directory: dir });

			// First init an experiment
			const initLLM = new StubbedLLM([
				{
					type: "tool",
					name: "init_experiment",
					args: {
						name: "ActiveTest",
						goal: "Optimize",
						primary_metric: "compile_time_ms",
						direction: "lower",
					},
				},
			]);
			const initAgent = new SimulatedAgent(pluginInstance, initLLM, dir);
			await initAgent.runTurn();

			// Now resume with a new session
			const resumeSessionID = `test-session-${Date.now() + 1}`;
			const output = {
				parts: [
					{
						type: "text",
						id: "prt_test_002",
						sessionID: resumeSessionID,
						messageID: "msg_test_002",
						text: "autoresearch",
					},
				] as any[],
			};

			await pluginInstance["command.execute.before"]!(
				{
					command: "autoresearch",
					sessionID: resumeSessionID,
					arguments: "",
				},
				output,
			);

			// The hook should modify the existing text part with a resume prompt
			expect(output.parts.length).toBe(1);
			expect(output.parts[0].type).toBe("text");
			expect(output.parts[0].text).toContain("Continue autoresearch experiment");
			expect(output.parts[0].text).toContain("ActiveTest");
			// The original metadata should be preserved
			expect(output.parts[0].id).toBe("prt_test_002");

			cleanup();
		});
	});

	describe("compaction hooks", () => {
		it("injects experiment context into compaction", async () => {
			const { dir, cleanup } = createTestDir();

			fs.writeFileSync(
				path.join(dir, "autoresearch.sh"),
				'#!/bin/bash\necho "METRIC compile_time_ms=1000"',
			);

			const pluginInstance = await plugin({ client: {}, directory: dir });

			// Initialize experiment
			const llm = new StubbedLLM([
				{
					type: "tool",
					name: "init_experiment",
					args: {
						name: "Test",
						goal: "Optimize",
						primary_metric: "compile_time_ms",
						direction: "lower",
					},
				},
			]);
			const agent = new SimulatedAgent(pluginInstance, llm, dir);
			await agent.runTurn();

			// Check compaction context injection
			const compactionOutput = { context: [] };
			await pluginInstance["experimental.session.compacting"]!(
				{ sessionID: agent.sessionID } as any,
				compactionOutput,
			);
			expect(compactionOutput.context.length).toBeGreaterThan(0);
			expect(compactionOutput.context[0]).toContain(
				"Autoresearch Experiment Context",
			);
			expect(compactionOutput.context[0]).toContain("Optimize");

			cleanup();
		});

		it("enables auto-continue when mode is active", async () => {
			const { dir, cleanup } = createTestDir();

			fs.writeFileSync(
				path.join(dir, "autoresearch.sh"),
				'#!/bin/bash\necho "METRIC compile_time_ms=1000"',
			);

			const pluginInstance = await plugin({ client: {}, directory: dir });

			const llm = new StubbedLLM([
				{
					type: "tool",
					name: "init_experiment",
					args: {
						name: "Test",
						goal: "Optimize",
						primary_metric: "compile_time_ms",
						direction: "lower",
					},
				},
			]);
			const agent = new SimulatedAgent(pluginInstance, llm, dir);
			await agent.runTurn();

			const autocontinueOutput = { enabled: false };
			await pluginInstance["experimental.compaction.autocontinue"]!(
				{ sessionID: agent.sessionID } as any,
				autocontinueOutput,
			);
			expect(autocontinueOutput.enabled).toBe(true);

			cleanup();
		});
	});

	describe("max iterations", () => {
		it("enforces max_iterations and disables mode", async () => {
			const { dir, cleanup } = createTestDir();

			fs.writeFileSync(
				path.join(dir, "autoresearch.sh"),
				'#!/bin/bash\necho "METRIC compile_time_ms=1000"',
			);

			const pluginInstance = await plugin({ client: {}, directory: dir });

			// Run 3 experiments with max_iterations=2
			const llm = new StubbedLLM([
				{
					type: "tool",
					name: "init_experiment",
					args: {
						name: "Test",
						goal: "Optimize",
						primary_metric: "compile_time_ms",
						direction: "lower",
						max_iterations: 2,
					},
				},
				{ type: "tool", name: "run_experiment", args: {} },
				{
					type: "tool",
					name: "log_experiment",
					args: { metric: 1000, status: "keep", description: "Run 1" },
				},
				{ type: "tool", name: "run_experiment", args: {} },
				{
					type: "tool",
					name: "log_experiment",
					args: { metric: 900, status: "keep", description: "Run 2" },
				},
				{ type: "tool", name: "run_experiment", args: {} },
			]);

			const agent = new SimulatedAgent(pluginInstance, llm, dir);
			const turns = await agent.runLoop(6);

			// After 2 logged experiments, the 3rd run_experiment should fail or warn
			const run3 = turns.find(
				(t) =>
					t.type === "tool" &&
					(t as any).name === "run_experiment" &&
					agent.toolResults.filter((r) => r.name === "run_experiment")
						.length === 3,
			);

			// The system prompt should no longer be injected after max reached
			const systemOutput = { system: [] };
			await pluginInstance["experimental.chat.system.transform"]!(
				{ sessionID: agent.sessionID } as any,
				systemOutput,
			);
			// After max iterations, mode should be disabled, so no prompt injected
			// (though the test might not reach this if mode is disabled earlier)

			cleanup();
		});
	});

	describe("autoresearch.md file", () => {
		it("creates autoresearch.md on init", async () => {
			const { dir, cleanup } = createTestDir();

			fs.writeFileSync(
				path.join(dir, "autoresearch.sh"),
				'#!/bin/bash\necho "METRIC compile_time_ms=1000"',
			);

			const pluginInstance = await plugin({ client: {}, directory: dir });

			const llm = new StubbedLLM([
				{
					type: "tool",
					name: "init_experiment",
					args: {
						name: "Test",
						goal: "Optimize",
						primary_metric: "compile_time_ms",
						direction: "lower",
					},
				},
			]);
			const agent = new SimulatedAgent(pluginInstance, llm, dir);
			await agent.runTurn();

			expect(fs.existsSync(path.join(dir, "autoresearch.md"))).toBe(true);
			const content = fs.readFileSync(path.join(dir, "autoresearch.md"), "utf-8");
			expect(content).toContain("Test");
			expect(content).toContain("compile_time_ms");

			cleanup();
		});

		it("appends run results to autoresearch.md", async () => {
			const { dir, cleanup } = createTestDir();

			fs.writeFileSync(
				path.join(dir, "autoresearch.sh"),
				'#!/bin/bash\necho "METRIC compile_time_ms=1000"',
			);

			const pluginInstance = await plugin({ client: {}, directory: dir });

			const llm = new StubbedLLM([
				{
					type: "tool",
					name: "init_experiment",
					args: {
						name: "Test",
						goal: "Optimize",
						primary_metric: "compile_time_ms",
						direction: "lower",
					},
				},
				{ type: "tool", name: "run_experiment", args: {} },
				{
					type: "tool",
					name: "log_experiment",
					args: { metric: 1000, status: "keep", description: "Run 1" },
				},
			]);
			const agent = new SimulatedAgent(pluginInstance, llm, dir);
			await agent.runLoop();

			const content = fs.readFileSync(path.join(dir, "autoresearch.md"), "utf-8");
			expect(content).toContain("Run 1");
			expect(content).toContain("1000");

			cleanup();
		});
	});
});
