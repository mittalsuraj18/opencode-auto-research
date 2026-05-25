import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createUpdateNotesTool } from "../../src/tools/update-notes";
import { AutoresearchStorage } from "../../src/storage";
import { createExperimentState } from "../../src/state";
import type { AutoresearchRuntime } from "../../src/types";
import { cleanupTestDir } from "../test-helpers";

function createTestEnv() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-update-notes-test-"));
	const dbPath = path.join(dir, "test.db");
	const storage = new AutoresearchStorage(dbPath, dir);

	// Create a session for testing
	const session = storage.insertSession({
		name: "Test",
		goal: "Test goal",
		primaryMetric: "test_coverage_pct",
		metricUnit: "%",
		direction: "higher",
		branch: null,
		baselineCommit: null,
		scopePaths: [],
		offLimits: [],
		constraints: [],
		secondaryMetrics: [],
		notes: "",
		maxIterations: 10,
	});

	const runtime: AutoresearchRuntime = {
		autoresearchMode: true,
		goal: "Test goal",
		state: createExperimentState(),
		runningExperiment: null,
		lastRunSummary: null,
		lastAutoResumePendingRunNumber: null,
		justLoggedExperiment: false,
		needsCompaction: false,
		currentModel: null,
	};

	const tool = createUpdateNotesTool({ storage, runtime, directory: dir });

	return {
		dir,
		storage,
		session,
		runtime,
		tool,
		cleanup: () => {
			storage.close();
			cleanupTestDir(dir);
		},
	};
}

describe("createUpdateNotesTool", () => {
	it("returns error when no active session", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-no-session-"));
		const dbPath = path.join(dir, "empty.db");
		const storage = new AutoresearchStorage(dbPath, dir);
		// No session inserted
		const runtime: AutoresearchRuntime = {
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
		const tool = createUpdateNotesTool({ storage, runtime, directory: dir });
		const result = await tool.execute({});
		expect(result.metadata.error).toBe("no_session");
		storage.close();
		cleanupTestDir(dir);
	});

	it("replaces notes with body", async () => {
		const env = createTestEnv();
		const result = await env.tool.execute({ body: "New notes content" });
		expect(result.output).toContain("New notes content");
		expect(env.runtime.state.notes).toBe("New notes content");

		// Verify storage was updated
		const session = env.storage.getSession(env.session.id);
		expect(session?.notes).toBe("New notes content");

		env.cleanup();
	});

	it("appends idea to existing notes", async () => {
		const env = createTestEnv();
		// First set some notes
		await env.tool.execute({ body: "Existing notes" });
		// Then append an idea
		const result = await env.tool.execute({ append_idea: "Try caching" });
		expect(result.output).toContain("Existing notes");
		expect(result.output).toContain("Try caching");
		expect(env.runtime.state.notes).toContain("- Try caching");

		env.cleanup();
	});

	it("appends idea to empty notes", async () => {
		const env = createTestEnv();
		const result = await env.tool.execute({ append_idea: "First idea" });
		expect(result.output).toContain("First idea");
		expect(env.runtime.state.notes).toBe("- First idea");

		env.cleanup();
	});

	it("replaces body and appends idea in same call", async () => {
		const env = createTestEnv();
		const result = await env.tool.execute({ body: "Base content", append_idea: "New idea" });
		expect(env.runtime.state.notes).toContain("Base content");
		expect(env.runtime.state.notes).toContain("- New idea");

		env.cleanup();
	});

	it("updates autoresearch.md when file exists", async () => {
		const env = createTestEnv();
		// Create autoresearch.md with Notes section
		const mdContent = `# Autoresearch: Test

## Notes
Old notes here

## Runs
| # | Status | Metric | Description |
|---|--------|--------|-------------|
`;
		fs.writeFileSync(path.join(env.dir, "autoresearch.md"), mdContent, "utf-8");

		await env.tool.execute({ body: "Updated notes" });

		const updated = fs.readFileSync(path.join(env.dir, "autoresearch.md"), "utf-8");
		expect(updated).toContain("Updated notes");
		expect(updated).not.toContain("Old notes here");

		env.cleanup();
	});

	it("does not error when autoresearch.md does not exist", async () => {
		const env = createTestEnv();
		// No autoresearch.md created
		const result = await env.tool.execute({ body: "Just notes" });
		expect(result.output).toContain("Just notes");

		env.cleanup();
	});

	it("handles append_idea with multiple ideas", async () => {
		const env = createTestEnv();
		await env.tool.execute({ append_idea: "Idea one" });
		await env.tool.execute({ append_idea: "Idea two" });
		await env.tool.execute({ append_idea: "Idea three" });

		const notes = env.runtime.state.notes;
		expect(notes).toContain("- Idea one");
		expect(notes).toContain("- Idea two");
		expect(notes).toContain("- Idea three");

		env.cleanup();
	});

	it("returns correct title and metadata", async () => {
		const env = createTestEnv();
		const result = await env.tool.execute({ body: "Test metadata" });
		expect(result.title).toBe("update_notes");
		expect(result.metadata.notes).toBe("Test metadata");

		env.cleanup();
	});

	it("handles empty body (sets notes to empty string)", async () => {
		const env = createTestEnv();
		// First set some notes
		await env.tool.execute({ body: "Some content" });
		// Then replace with empty
		const result = await env.tool.execute({ body: "" });
		expect(env.runtime.state.notes).toBe("");

		env.cleanup();
	});

	it("appends idea after setting empty body", async () => {
		const env = createTestEnv();
		await env.tool.execute({ body: "", append_idea: "Fresh start idea" });
		expect(env.runtime.state.notes).toBe("- Fresh start idea");

		env.cleanup();
	});
});
