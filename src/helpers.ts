/**
 * @file helpers.ts
 * @description Provides parsing, formatting, path normalization, and git utility functions.
 * Implements metric parsing, output truncation, and dirty path computation.
 */

import * as path from "node:path";
import { $ } from "bun";
import type { ASIData, MetricDirection, NumericMetricMap } from "./types";

const DENIED_KEY_NAMES = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Formats a numeric value with the appropriate unit suffix.
 * @param value - Numeric value to format
 * @param unit - Unit string (e.g., "ms", "kb", "s")
 * @returns Formatted string representation
 */
export function formatNum(value: number | null | undefined, unit: string): string {
	if (value === null || value === undefined || Number.isNaN(value)) return "-";
	if (unit === "µs" || unit.endsWith("_µs")) return `${value.toFixed(2)}µs`;
	if (unit === "ms" || unit.endsWith("_ms")) return `${value.toFixed(2)}ms`;
	if (unit === "s" || unit.endsWith("_s") || unit.endsWith("_sec")) return `${value.toFixed(2)}s`;
	if (unit === "kb" || unit.endsWith("_kb")) return `${value.toFixed(1)}KB`;
	if (unit === "mb" || unit.endsWith("_mb")) return `${value.toFixed(1)}MB`;
	return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Formats a duration in milliseconds into a human-readable string.
 * @param ms - Duration in milliseconds
 * @returns Human-readable duration string (e.g., "2h 15m", "45s")
 */
export function formatElapsed(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds >= 3600) {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		return `${hours}h ${minutes}m`;
	}
	if (seconds >= 60) {
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return `${minutes}m ${remainingSeconds}s`;
	}
	return `${seconds}s`;
}

/**
 * Determines whether a metric value is better than the current best.
 * @param current - The new metric value
 * @param best - The current best metric value
 * @param direction - Optimization direction (lower or higher)
 * @returns True if current is better than best
 */
export function isBetter(current: number, best: number, direction: MetricDirection): boolean {
	return direction === "lower" ? current < best : current > best;
}

/**
 * Infers the unit for a metric from its name suffix.
 * @param name - Metric name string
 * @returns Inferred unit string (e.g., "ms", "kb", "s") or empty string
 */
export function inferMetricUnitFromName(name: string): string {
	if (name.endsWith("µs") || name.endsWith("_µs")) return "µs";
	if (name.endsWith("ms") || name.endsWith("_ms")) return "ms";
	if (name.endsWith("_s") || name.endsWith("_sec") || name.endsWith("_secs")) return "s";
	if (name.endsWith("_kb") || name.endsWith("kb")) return "kb";
	if (name.endsWith("_mb") || name.endsWith("mb")) return "mb";
	return "";
}

/**
 * Normalizes a path specification for consistent comparison.
 * @param value - Raw path string
 * @returns Normalized path specification
 */
export function normalizePathSpec(value: string): string {
	const trimmed = value.trim().replaceAll("\\", "/");
	if (trimmed === "" || trimmed === "." || trimmed === "./") return ".";
	const collapsed = trimmed.replace(/^\.\/+/, "").replace(/\/+$/, "");
	return collapsed.length === 0 ? "." : collapsed;
}

/**
 * Checks whether a path matches a given scope specification.
 * @param pathValue - The path to test
 * @param specValue - The scope specification
 * @returns True if the path matches the specification
 */
export function pathMatchesSpec(pathValue: string, specValue: string): boolean {
	const normalizedPath = normalizePathSpec(pathValue);
	const normalizedSpec = normalizePathSpec(specValue);
	if (normalizedSpec === ".") return true;
	return normalizedPath === normalizedSpec || normalizedPath.startsWith(`${normalizedSpec}/`);
}

/**
 * Removes duplicate and empty strings from an array while preserving order.
 * @param values - Array of strings, potentially with duplicates
 * @returns Deduplicated array of trimmed non-empty strings
 */
export function dedupeStrings(values: readonly string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const trimmed = value.trim();
		if (trimmed.length === 0 || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

/**
 * Sanitizes a metric map by removing non-finite and unsafe keys.
 * @param value - Input numeric metric map
 * @returns Cleaned numeric metric map with only finite numbers
 */
export function ensureNumericMetricMap(value: NumericMetricMap | undefined): NumericMetricMap {
	if (!value) return {};
	const out: NumericMetricMap = {};
	for (const [key, entryValue] of Object.entries(value)) {
		if (DENIED_KEY_NAMES.has(key)) continue;
		if (typeof entryValue === "number" && Number.isFinite(entryValue)) {
			out[key] = entryValue;
		}
	}
	return out;
}

/**
 * Sanitizes Agent State Info values by removing unsafe keys and undefined entries.
 * @param value - Raw ASI record object
 * @returns Sanitized ASIData or undefined if empty
 */
export function sanitizeAsi(value: Record<string, unknown> | undefined): ASIData | undefined {
	if (!value) return undefined;
	const result: ASIData = {};
	for (const [key, entryValue] of Object.entries(value)) {
		if (DENIED_KEY_NAMES.has(key)) continue;
		const sanitized = sanitizeAsiValue(entryValue);
		if (sanitized !== undefined) {
			result[key] = sanitized;
		}
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

/** Recursively sanitizes an ASI value into a safe ASIData-compatible value */
function sanitizeAsiValue(value: unknown): import("./types").ASIValue | undefined {
	if (value === null) return null;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
	if (Array.isArray(value)) {
		const items = value
			.map((item) => sanitizeAsiValue(item))
			.filter((item): item is NonNullable<typeof item> => item !== undefined);
		return items;
	}
	if (typeof value === "object") {
		const objectValue = value as Record<string, unknown>;
		const result: ASIData = {};
		for (const [key, entryValue] of Object.entries(objectValue)) {
			if (DENIED_KEY_NAMES.has(key)) continue;
			const sanitized = sanitizeAsiValue(entryValue);
			if (sanitized !== undefined) {
				result[key] = sanitized;
			}
		}
		return result;
	}
	return undefined;
}

/**
 * Parses a single METRIC line from benchmark output.
 * @param line - Raw output line to parse
 * @returns Parsed metric name and value, or null if not a valid METRIC line
 */
export function parseMetricLine(line: string): { name: string; value: number } | null {
	const match = line.match(/^METRIC\s+(\S+)\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
	if (!match) return null;
	const value = Number.parseFloat(match[2]);
	if (Number.isNaN(value)) return null;
	return { name: match[1], value };
}

/**
 * Parses a single ASI line from benchmark output.
 * @param line - Raw output line to parse
 * @returns Parsed ASI key and value string, or null if not a valid ASI line
 */
export function parseAsiLine(line: string): { key: string; value: string } | null {
	const match = line.match(/^ASI\s+([^=]+?)\s*=\s*(.*)$/);
	if (!match) return null;
	return { key: match[1].trim(), value: match[2].trim() };
}

/**
 * Parses full benchmark output to extract metrics and ASI data.
 * @param output - Raw benchmark harness output
 * @param primaryMetricName - Name of the primary metric to extract
 * @returns Object containing primary metric, all metrics map, and ASI data
 */
export function parseBenchmarkOutput(
	output: string,
	primaryMetricName: string,
): {
	primaryMetric: number | null;
	metrics: NumericMetricMap;
	asi: ASIData;
} {
	const lines = output.split("\n");
	const metrics: NumericMetricMap = {};
	const asi: ASIData = {};
	let primaryMetric: number | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		const metricMatch = parseMetricLine(trimmed);
		if (metricMatch) {
			metrics[metricMatch.name] = metricMatch.value;
			if (metricMatch.name === primaryMetricName) {
				primaryMetric = metricMatch.value;
			}
			continue;
		}
		const asiMatch = parseAsiLine(trimmed);
		if (asiMatch) {
			asi[asiMatch.key] = asiMatch.value;
		}
	}

	return { primaryMetric, metrics, asi };
}

/**
 * Truncates benchmark output to a maximum number of lines and characters.
 * @param output - Raw output string
 * @param maxChars - Maximum characters to include (default: 4000)
 * @param maxLines - Maximum lines to include (default: 10)
 * @returns Truncated output string with ellipsis indicators
 */
export function truncateOutput(output: string, maxChars = 4000, maxLines = 10): string {
	const lines = output.split("\n");
	if (lines.length <= maxLines && output.length <= maxChars) {
		return output;
	}
	const truncatedLines = lines.slice(0, maxLines);
	let result = truncatedLines.join("\n");
	if (lines.length > maxLines) {
		result += `\n... (${lines.length - maxLines} more lines, ${output.length} total chars) ...`;
	}
	if (result.length > maxChars) {
		result = result.slice(0, maxChars) + "\n[truncated]";
	}
	return result;
}

/**
 * Retrieves the git status output for a working directory.
 * @param cwd - Path to the git working directory
 * @returns Git status string in porcelain format, or empty string on failure
 */
export async function tryGitStatus(cwd: string): Promise<string> {
	try {
		const result = await $`git -C ${cwd} status --porcelain -z --untracked-files=all`.text();
		return result;
	} catch {
		return "";
	}
}

/**
 * Retrieves the git work directory prefix relative to the repository root.
 * @param cwd - Path to the git working directory
 * @returns Normalized prefix string, or empty string on failure
 */
export async function tryGitPrefix(cwd: string): Promise<string> {
	try {
		const result = await $`git -C ${cwd} rev-parse --show-prefix`.text();
		return normalizePathSpec(result);
	} catch {
		return "";
	}
}

/**
 * Parses git status output into an array of dirty path strings.
 * @param statusOutput - Raw git status output
 * @returns Array of normalized dirty paths
 */
export function parseDirtyPaths(statusOutput: string): string[] {
	if (statusOutput.includes("\0")) {
		return parseDirtyPathsNul(statusOutput);
	}
	return parseDirtyPathsLines(statusOutput);
}

/** Parses NUL-delimited git status output into dirty paths */
function parseDirtyPathsNul(statusOutput: string): string[] {
	const unsafePaths = new Set<string>();
	let index = 0;
	while (index + 3 <= statusOutput.length) {
		const statusToken = statusOutput.slice(index, index + 3);
		index += 3;
		const pathEnd = statusOutput.indexOf("\0", index);
		if (pathEnd < 0) break;
		const firstPath = statusOutput.slice(index, pathEnd);
		index = pathEnd + 1;
		addDirtyPath(unsafePaths, firstPath);
		if (isRenameOrCopy(statusToken)) {
			const secondPathEnd = statusOutput.indexOf("\0", index);
			if (secondPathEnd < 0) break;
			const secondPath = statusOutput.slice(index, secondPathEnd);
			index = secondPathEnd + 1;
			addDirtyPath(unsafePaths, secondPath);
		}
	}
	return [...unsafePaths];
}

/** Parses line-based git status output into dirty paths */
function parseDirtyPathsLines(statusOutput: string): string[] {
	const unsafePaths = new Set<string>();
	for (const line of statusOutput.split("\n")) {
		const trimmedLine = line.trimEnd();
		if (trimmedLine.length < 4) continue;
		const rawPath = trimmedLine.slice(3).trim();
		if (rawPath.length === 0) continue;
		const renameParts = rawPath.split(" -> ");
		for (const renamePart of renameParts) {
			addDirtyPath(unsafePaths, renamePart);
		}
	}
	return [...unsafePaths];
}

/** Normalizes and adds a raw path to the dirty paths set */
function addDirtyPath(paths: Set<string>, rawPath: string): void {
	const normalizedPath = normalizeStatusPath(rawPath);
	if (normalizedPath.length === 0) return;
	paths.add(normalizedPath);
}

/**
 * Normalizes a raw git status path, handling quoted paths.
 * @param rawPath - Raw path from git status
 * @returns Normalized path string
 */
export function normalizeStatusPath(rawPath: string): string {
	let normalized = rawPath.trim();
	if (normalized.startsWith('"') && normalized.endsWith('"')) {
		normalized = normalized.slice(1, -1);
	}
	return normalizePathSpec(normalized);
}

/** Checks if a git status token indicates a rename or copy operation */
function isRenameOrCopy(statusToken: string): boolean {
	const trimmed = statusToken.trim();
	return trimmed.startsWith("R") || trimmed.startsWith("C");
}

/**
 * Converts dirty paths from git status to be relative to the current work directory.
 * @param statusOutput - Raw git status output
 * @param workDirPrefix - Prefix for the current working directory within the repo
 * @returns Array of relative dirty paths
 */
export function parseWorkDirDirtyPaths(statusOutput: string, workDirPrefix: string): string[] {
	const relativePaths: string[] = [];
	for (const dirtyPath of parseDirtyPaths(statusOutput)) {
		const relativePath = relativizeGitPathToWorkDir(dirtyPath, workDirPrefix);
		if (relativePath === null) continue;
		relativePaths.push(relativePath);
	}
	return relativePaths;
}

/**
 * Converts a repository-relative path to be relative to the work directory.
 * @param repoRelativePath - Path relative to the repository root
 * @param workDirPrefix - Prefix for the current working directory within the repo
 * @returns Relative path string, or null if outside the work directory
 */
export function relativizeGitPathToWorkDir(
	repoRelativePath: string,
	workDirPrefix: string,
): string | null {
	const normalizedPath = normalizeStatusPath(repoRelativePath);
	const normalizedPrefix = normalizePathSpec(workDirPrefix);
	if (normalizedPrefix === "" || normalizedPrefix === ".") {
		return normalizedPath;
	}
	if (normalizedPath === normalizedPrefix) {
		return ".";
	}
	if (!normalizedPath.startsWith(`${normalizedPrefix}/`)) {
		return null;
	}
	return normalizePathSpec(normalizedPath.slice(normalizedPrefix.length + 1));
}

/**
 * Computes the files modified during a benchmark run by comparing pre and post-run status.
 * @param preRunDirtyPaths - Dirty paths recorded before the run
 * @param currentStatusOutput - Git status output after the run
 * @param workDirPrefix - Prefix for the current working directory
 * @returns Object with tracked and untracked modified file arrays
 */
export function computeRunModifiedPaths(
	preRunDirtyPaths: string[],
	currentStatusOutput: string,
	workDirPrefix: string,
): { tracked: string[]; untracked: string[] } {
	const preRunSet = new Set(preRunDirtyPaths);
	const tracked: string[] = [];
	const untracked: string[] = [];
	for (const entry of parseWorkDirDirtyPathsWithStatus(currentStatusOutput, workDirPrefix)) {
		if (preRunSet.has(entry.path)) continue;
		if (entry.untracked) {
			untracked.push(entry.path);
		} else {
			tracked.push(entry.path);
		}
	}
	return { tracked, untracked };
}

/**
 * Parses git status and converts dirty paths with their tracked/untracked status.
 * @param statusOutput - Raw git status output
 * @param workDirPrefix - Prefix for the current working directory
 * @returns Array of dirty path entries with untracked flag
 */
export function parseWorkDirDirtyPathsWithStatus(
	statusOutput: string,
	workDirPrefix: string,
): Array<{ path: string; untracked: boolean }> {
	const results: Array<{ path: string; untracked: boolean }> = [];
	const seen = new Set<string>();
	const entries = parseDirtyPathsWithStatus(statusOutput);
	for (const entry of entries) {
		const relativePath = relativizeGitPathToWorkDir(entry.path, workDirPrefix);
		if (relativePath === null) continue;
		if (seen.has(relativePath)) continue;
		seen.add(relativePath);
		results.push({ path: relativePath, untracked: entry.untracked });
	}
	return results;
}

/**
 * Parses git status output into path entries with tracked/untracked status.
 * @param statusOutput - Raw git status output
 * @returns Array of path entries indicating whether each is untracked
 */
export function parseDirtyPathsWithStatus(
	statusOutput: string,
): Array<{ path: string; untracked: boolean }> {
	if (statusOutput.includes("\0")) {
		return parseDirtyPathsNulWithStatus(statusOutput);
	}
	return parseDirtyPathsLinesWithStatus(statusOutput);
}

/** Parses NUL-delimited git status into entries with tracked/untracked status */
function parseDirtyPathsNulWithStatus(
	statusOutput: string,
): Array<{ path: string; untracked: boolean }> {
	const seen = new Set<string>();
	const results: Array<{ path: string; untracked: boolean }> = [];
	let index = 0;
	while (index + 3 <= statusOutput.length) {
		const statusToken = statusOutput.slice(index, index + 3);
		index += 3;
		const pathEnd = statusOutput.indexOf("\0", index);
		if (pathEnd < 0) break;
		const firstPath = statusOutput.slice(index, pathEnd);
		index = pathEnd + 1;
		const untracked = statusToken.trim().startsWith("??");
		addDirtyPathEntry(seen, results, firstPath, untracked);
		if (isRenameOrCopy(statusToken)) {
			const secondPathEnd = statusOutput.indexOf("\0", index);
			if (secondPathEnd < 0) break;
			const secondPath = statusOutput.slice(index, secondPathEnd);
			index = secondPathEnd + 1;
			addDirtyPathEntry(seen, results, secondPath, false);
		}
	}
	return results;
}

/** Parses line-based git status into entries with tracked/untracked status */
function parseDirtyPathsLinesWithStatus(
	statusOutput: string,
): Array<{ path: string; untracked: boolean }> {
	const seen = new Set<string>();
	const results: Array<{ path: string; untracked: boolean }> = [];
	for (const line of statusOutput.split("\n")) {
		const trimmedLine = line.trimEnd();
		if (trimmedLine.length < 4) continue;
		const statusToken = trimmedLine.slice(0, 3);
		const rawPath = trimmedLine.slice(3).trim();
		if (rawPath.length === 0) continue;
		const untracked = statusToken.trim().startsWith("??");
		const renameParts = rawPath.split(" -> ");
		for (const renamePart of renameParts) {
			addDirtyPathEntry(seen, results, renamePart, untracked);
		}
	}
	return results;
}

/** Adds a normalized dirty path entry to the results if not already seen */
function addDirtyPathEntry(
	seen: Set<string>,
	results: Array<{ path: string; untracked: boolean }>,
	rawPath: string,
	untracked: boolean,
): void {
	const normalizedPath = normalizeStatusPath(rawPath);
	if (normalizedPath.length === 0 || seen.has(normalizedPath)) return;
	seen.add(normalizedPath);
	results.push({ path: normalizedPath, untracked });
}
