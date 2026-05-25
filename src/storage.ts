// storage.ts
// SQLite persistence for autoresearch sessions and runs.

import * as fs from "node:fs";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import type {
	InsertRunParams,
	MarkRunCompletedParams,
	MarkRunLoggedParams,
	NumericMetricMap,
	SessionRow,
} from "./types";

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS sessions (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	goal TEXT,
	primary_metric TEXT NOT NULL,
	metric_unit TEXT NOT NULL DEFAULT '',
	direction TEXT NOT NULL DEFAULT 'lower',
	branch TEXT,
	baseline_commit TEXT,
	current_segment INTEGER NOT NULL DEFAULT 0,
	max_iterations INTEGER,
	scope_paths_json TEXT NOT NULL DEFAULT '[]',
	off_limits_json TEXT NOT NULL DEFAULT '[]',
	constraints_json TEXT NOT NULL DEFAULT '[]',
	secondary_metrics_json TEXT NOT NULL DEFAULT '[]',
	notes TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	closed_at INTEGER
);

CREATE TABLE IF NOT EXISTS runs (
	id INTEGER PRIMARY KEY,
	session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	segment INTEGER NOT NULL,
	command TEXT NOT NULL,
	started_at INTEGER NOT NULL,
	completed_at INTEGER,
	duration_ms INTEGER,
	exit_code INTEGER,
	timed_out INTEGER NOT NULL DEFAULT 0,
	parsed_primary REAL,
	parsed_metrics_json TEXT,
	parsed_asi_json TEXT,
	pre_run_dirty_paths_json TEXT NOT NULL DEFAULT '[]',
	log_path TEXT NOT NULL,
	status TEXT,
	description TEXT,
	metric REAL,
	metrics_json TEXT,
	asi_json TEXT,
	commit_hash TEXT,
	confidence REAL,
	modified_paths_json TEXT,
	scope_deviations_json TEXT,
	justification TEXT,
	flagged INTEGER NOT NULL DEFAULT 0,
	flagged_reason TEXT,
	logged_at INTEGER,
	abandoned_at INTEGER
);

CREATE INDEX IF NOT EXISTS runs_session_segment_idx ON runs(session_id, segment);
CREATE INDEX IF NOT EXISTS runs_pending_idx ON runs(session_id, status, abandoned_at);
`;

type SessionDbRow = {
	id: number;
	name: string;
	goal: string | null;
	primary_metric: string;
	metric_unit: string;
	direction: string;
	branch: string | null;
	baseline_commit: string | null;
	current_segment: number;
	max_iterations: number | null;
	scope_paths_json: string;
	off_limits_json: string;
	constraints_json: string;
	secondary_metrics_json: string;
	notes: string;
	created_at: number;
	closed_at: number | null;
};

type RunDbRow = {
	id: number;
	session_id: number;
	segment: number;
	command: string;
	started_at: number;
	completed_at: number | null;
	duration_ms: number | null;
	exit_code: number | null;
	timed_out: number;
	parsed_primary: number | null;
	parsed_metrics_json: string | null;
	parsed_asi_json: string | null;
	pre_run_dirty_paths_json: string;
	log_path: string;
	status: string | null;
	description: string | null;
	metric: number | null;
	metrics_json: string | null;
	asi_json: string | null;
	commit_hash: string | null;
	confidence: number | null;
	modified_paths_json: string | null;
	scope_deviations_json: string | null;
	justification: string | null;
	flagged: number;
	flagged_reason: string | null;
	logged_at: number | null;
	abandoned_at: number | null;
};

export class AutoresearchStorage {
	#db: Database;
	#projectDir: string;
	#dbPath: string;

	constructor(dbPath: string, projectDir: string) {
		this.#dbPath = dbPath;
		this.#projectDir = projectDir;
		fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		this.#db = new Database(dbPath);
		this.#db.run(SCHEMA_SQL);
		const versionRow = this.#db.query("PRAGMA user_version").get() as { user_version: number } | null;
		const currentVersion = versionRow?.user_version ?? 0;
		if (currentVersion < SCHEMA_VERSION) {
			this.#db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
		}
	}

	get dbPath(): string {
		return this.#dbPath;
	}

	get projectDir(): string {
		return this.#projectDir;
	}

	close(): void {
		this.#db.close();
	}

	getActiveSession(): SessionRow | null {
		const stmt = this.#db.prepare(
			"SELECT * FROM sessions WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1",
		);
		const row = stmt.get() as SessionDbRow | null;
		return row ? rowToSession(row) : null;
	}

	getActiveSessionForBranch(branch: string | null): SessionRow | null {
		if (branch === null) {
			const stmt = this.#db.prepare(
				"SELECT * FROM sessions WHERE closed_at IS NULL AND branch IS NULL ORDER BY id DESC LIMIT 1",
			);
			const row = stmt.get() as SessionDbRow | null;
			return row ? rowToSession(row) : null;
		}
		const stmt = this.#db.prepare(
			"SELECT * FROM sessions WHERE closed_at IS NULL AND branch = ? ORDER BY id DESC LIMIT 1",
		);
		const row = stmt.get(branch) as SessionDbRow | null;
		return row ? rowToSession(row) : null;
	}

	getSession(id: number): SessionRow | null {
		const stmt = this.#db.prepare("SELECT * FROM sessions WHERE id = ?");
		const row = stmt.get(id) as SessionDbRow | null;
		return row ? rowToSession(row) : null;
	}

	insertSession(params: {
		name: string;
		goal: string | null;
		primaryMetric: string;
		metricUnit: string;
		direction: string;
		branch: string | null;
		baselineCommit: string | null;
		scopePaths: string[];
		offLimits: string[];
		constraints: string[];
		secondaryMetrics: string[];
		notes: string;
		maxIterations: number | null;
	}): SessionRow {
		const now = Date.now();
		const stmt = this.#db.prepare(
			"INSERT INTO sessions (name, goal, primary_metric, metric_unit, direction, branch, baseline_commit, current_segment, max_iterations, scope_paths_json, off_limits_json, constraints_json, secondary_metrics_json, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
		);
		const row = stmt.get(
			params.name,
			params.goal,
			params.primaryMetric,
			params.metricUnit,
			params.direction,
			params.branch,
			params.baselineCommit,
			0,
			params.maxIterations,
			JSON.stringify(params.scopePaths),
			JSON.stringify(params.offLimits),
			JSON.stringify(params.constraints),
			JSON.stringify(params.secondaryMetrics),
			params.notes,
			now,
		) as SessionDbRow;
		return rowToSession(row);
	}

	closeSession(id: number): void {
		this.#db.run("UPDATE sessions SET closed_at = ? WHERE id = ?", [Date.now(), id]);
	}

	incrementSegment(id: number): void {
		this.#db.run("UPDATE sessions SET current_segment = current_segment + 1 WHERE id = ?", [id]);
	}

	updateNotes(id: number, notes: string): void {
		this.#db.run("UPDATE sessions SET notes = ? WHERE id = ?", [notes, id]);
	}

	insertRun(params: InsertRunParams): { id: number } {
		const stmt = this.#db.prepare(
			"INSERT INTO runs (session_id, segment, command, started_at, pre_run_dirty_paths_json, log_path) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
		);
		const row = stmt.get(
			params.sessionId,
			params.segment,
			params.command,
			params.startedAt,
			JSON.stringify(params.preRunDirtyPaths),
			params.logPath,
		) as { id: number };
		return row;
	}

	markRunCompleted(params: MarkRunCompletedParams): void {
		this.#db.run(
			"UPDATE runs SET completed_at = ?, duration_ms = ?, exit_code = ?, timed_out = ?, parsed_primary = ?, parsed_metrics_json = ?, parsed_asi_json = ? WHERE id = ?",
			[
				params.completedAt,
				params.durationMs,
				params.exitCode,
				params.timedOut ? 1 : 0,
				params.parsedPrimary,
				params.parsedMetrics ? JSON.stringify(params.parsedMetrics) : null,
				params.parsedAsi ? JSON.stringify(params.parsedAsi) : null,
				params.runId,
			],
		);
	}

	markRunLogged(params: MarkRunLoggedParams): void {
		this.#db.run(
			"UPDATE runs SET status = ?, description = ?, metric = ?, metrics_json = ?, asi_json = ?, commit_hash = ?, confidence = ?, modified_paths_json = ?, scope_deviations_json = ?, justification = ?, logged_at = ? WHERE id = ?",
			[
				params.status,
				params.description,
				params.metric,
				JSON.stringify(params.metrics),
				params.asi ? JSON.stringify(params.asi) : null,
				params.commitHash,
				params.confidence,
				JSON.stringify(params.modifiedPaths),
				JSON.stringify(params.scopeDeviations),
				params.justification,
				params.loggedAt,
				params.runId,
			],
		);
	}

	getRunsForSession(sessionId: number): RunDbRow[] {
		const stmt = this.#db.prepare(
			"SELECT * FROM runs WHERE session_id = ? AND abandoned_at IS NULL ORDER BY started_at",
		);
		return stmt.all(sessionId) as RunDbRow[];
	}

	abandonPendingRuns(sessionId: number): void {
		this.#db.run("UPDATE runs SET abandoned_at = ? WHERE session_id = ? AND status IS NULL", [Date.now(), sessionId]);
	}

	countRunsInSegment(sessionId: number, segment: number): number {
		const stmt = this.#db.prepare(
			"SELECT COUNT(*) as count FROM runs WHERE session_id = ? AND segment = ? AND status IS NOT NULL",
		);
		const row = stmt.get(sessionId, segment) as { count: number } | null;
		return row?.count ?? 0;
	}
}

function rowToSession(row: SessionDbRow): SessionRow {
	return {
		id: row.id,
		name: row.name,
		goal: row.goal,
		primaryMetric: row.primary_metric,
		metricUnit: row.metric_unit,
		direction: row.direction as "lower" | "higher",
		branch: row.branch,
		baselineCommit: row.baseline_commit,
		currentSegment: row.current_segment,
		maxIterations: row.max_iterations,
		scopePaths: safeParseJson<string[]>(row.scope_paths_json, []),
		offLimits: safeParseJson<string[]>(row.off_limits_json, []),
		constraints: safeParseJson<string[]>(row.constraints_json, []),
		secondaryMetrics: safeParseJson<string[]>(row.secondary_metrics_json, []),
		notes: row.notes,
		createdAt: row.created_at,
		closedAt: row.closed_at,
	};
}

function safeParseJson<T>(json: string, fallback: T): T {
	try {
		return JSON.parse(json) as T;
	} catch {
		return fallback;
	}
}

export function openAutoresearchStorage(projectDir: string): AutoresearchStorage {
	const stateDir = path.join(process.env.HOME ?? "/tmp", ".opencode-autoresearch");
	const encodedProject = encodeURIComponent(projectDir);
	const dbPath = path.join(stateDir, `${encodedProject}.db`);
	return new AutoresearchStorage(dbPath, projectDir);
}

export function openAutoresearchStorageIfExists(projectDir: string): AutoresearchStorage | null {
	const stateDir = path.join(process.env.HOME ?? "/tmp", ".opencode-autoresearch");
	const encodedProject = encodeURIComponent(projectDir);
	const dbPath = path.join(stateDir, `${encodedProject}.db`);
	if (!fs.existsSync(dbPath)) return null;
	return new AutoresearchStorage(dbPath, projectDir);
}
