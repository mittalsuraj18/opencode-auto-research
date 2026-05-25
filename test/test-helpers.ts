/**
 * @file test-helpers.ts
 * @description Shared test utilities for cleanup and setup.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Clean up both the temp dir and any DB/run files the plugin created
 * under ~/.opencode-autoresearch/ for that directory.
 */
export function cleanupTestDir(dir: string): void {
	fs.rmSync(dir, { recursive: true, force: true });
	const stateDir = path.join(process.env.HOME ?? "/tmp", ".opencode-autoresearch");
	const encodedProject = encodeURIComponent(dir);
	// Clean up DB files
	const dbPrefix = path.join(stateDir, encodedProject);
	for (const suffix of [".db", ".db-shm", ".db-wal"]) {
		const p = dbPrefix + suffix;
		if (fs.existsSync(p)) fs.rmSync(p, { force: true });
	}
	// Clean up run log directories
	const runDir = path.join(stateDir, encodedProject);
	if (fs.existsSync(runDir)) fs.rmSync(runDir, { recursive: true, force: true });
}

/**
 * Create a temp directory with automatic cleanup tracking.
 */
export function createTempDir(prefix: string = "autoresearch-test-"): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
