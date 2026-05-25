import { describe, expect, it } from "bun:test";
import {
	normalizePathSpec,
	normalizeStatusPath,
	parseDirtyPaths,
	parseDirtyPathsWithStatus,
	parseWorkDirDirtyPaths,
	parseWorkDirDirtyPathsWithStatus,
	computeRunModifiedPaths,
	relativizeGitPathToWorkDir,
	dedupeStrings,
	sanitizeAsi,
} from "../../src/helpers";

describe("normalizeStatusPath", () => {
	it("removes surrounding quotes", () => {
		expect(normalizeStatusPath('"src/index.ts"')).toBe("src/index.ts");
	});

	it("handles unquoted paths", () => {
		expect(normalizeStatusPath("src/index.ts")).toBe("src/index.ts");
	});

	it("normalizes backslashes inside quoted path", () => {
		expect(normalizeStatusPath('"src\\index.ts"')).toBe("src/index.ts");
	});

	it("handles empty string", () => {
		expect(normalizeStatusPath("")).toBe(".");
	});

	it("handles whitespace-only string", () => {
		expect(normalizeStatusPath("   ")).toBe(".");
	});
});

describe("parseDirtyPaths — NUL-terminated with renames", () => {
	it("parses rename entries (R status)", () => {
		// Git -z format: 2-char XY status + space, then NUL-terminated paths
		// For renames: e.g. "R100" followed by NUL, old path, NUL, new path, NUL
		const status = "R \0old_name.ts\0new_name.ts\0";
		const paths = parseDirtyPaths(status);
		expect(paths).toContain("old_name.ts");
		expect(paths).toContain("new_name.ts");
	});

	it("parses copy entries (C status)", () => {
		const status = "C \0original.ts\0copy.ts\0";
		const paths = parseDirtyPaths(status);
		expect(paths).toContain("original.ts");
		expect(paths).toContain("copy.ts");
	});

	it("deduplicates paths in NUL format", () => {
		const status = " M\0src/index.ts\0 M\0src/index.ts\0";
		const paths = parseDirtyPaths(status);
		expect(paths).toEqual(["src/index.ts"]);
	});
});

describe("parseDirtyPathsWithStatus", () => {
	it("parses NUL-terminated with untracked flag", () => {
		const status = "??\0src/new.ts\0 M\0src/old.ts\0";
		const entries = parseDirtyPathsWithStatus(status);
		expect(entries).toHaveLength(2);
		const newEntry = entries.find((e) => e.path === "src/new.ts");
		const oldEntry = entries.find((e) => e.path === "src/old.ts");
		expect(newEntry?.untracked).toBe(true);
		expect(oldEntry?.untracked).toBe(false);
	});

	it("parses line format with untracked flag", () => {
		const status = "?? src/new.ts\n M src/old.ts";
		const entries = parseDirtyPathsWithStatus(status);
		expect(entries).toHaveLength(2);
		const newEntry = entries.find((e) => e.path === "src/new.ts");
		const oldEntry = entries.find((e) => e.path === "src/old.ts");
		expect(newEntry?.untracked).toBe(true);
		expect(oldEntry?.untracked).toBe(false);
	});

	it("deduplicates entries by path", () => {
		const status = " M\0src/index.ts\0 M\0src/index.ts\0";
		const entries = parseDirtyPathsWithStatus(status);
		expect(entries).toHaveLength(1);
	});

	it("handles rename with status (first path is untracked=false)", () => {
		const status = "R \0old.ts\0new.ts\0";
		const entries = parseDirtyPathsWithStatus(status);
		expect(entries).toHaveLength(2);
		const oldEntry = entries.find((e) => e.path === "old.ts");
		expect(oldEntry?.untracked).toBe(false);
	});
});

describe("parseWorkDirDirtyPathsWithStatus", () => {
	it("filters by workdir prefix and deduplicates", () => {
		const status = " M\0packages/core/src/a.ts\0 M\0packages/core/src/a.ts\0??\0packages/core/src/b.ts\0";
		const entries = parseWorkDirDirtyPathsWithStatus(status, "packages/core");
		expect(entries).toHaveLength(2);
		expect(entries.find((e) => e.path === "src/a.ts")).toBeDefined();
		expect(entries.find((e) => e.path === "src/b.ts")?.untracked).toBe(true);
	});

	it("returns empty for non-matching prefix", () => {
		const status = " M\0other/index.ts\0";
		const entries = parseWorkDirDirtyPathsWithStatus(status, "packages/core");
		expect(entries).toEqual([]);
	});
});

describe("relativizeGitPathToWorkDir — edge cases", () => {
	it("returns '.' when path equals prefix", () => {
		expect(relativizeGitPathToWorkDir("packages/core", "packages/core")).toBe(".");
	});

	it("returns null for non-matching prefix", () => {
		expect(relativizeGitPathToWorkDir("packages/other/src/a.ts", "packages/core")).toBeNull();
	});

	it("handles '.' prefix returning the path as-is", () => {
		expect(relativizeGitPathToWorkDir("src/index.ts", ".")).toBe("src/index.ts");
	});
});

describe("computeRunModifiedPaths — additional cases", () => {
	it("separates tracked and untracked with prefix", () => {
		const preRun = [];
		const current = " M\0packages/core/src/a.ts\0??\0packages/core/src/b.ts\0";
		const result = computeRunModifiedPaths(preRun, current, "packages/core");
		expect(result.tracked).toContain("src/a.ts");
		expect(result.untracked).toContain("src/b.ts");
	});

	it("handles empty pre-run and current status", () => {
		const result = computeRunModifiedPaths([], "", "");
		expect(result.tracked).toEqual([]);
		expect(result.untracked).toEqual([]);
	});
});

describe("dedupeStrings — edge cases", () => {
	it("handles all duplicates", () => {
		expect(dedupeStrings(["a", "a", "a"])).toEqual(["a"]);
	});

	it("preserves order", () => {
		expect(dedupeStrings(["c", "b", "a", "b", "c"])).toEqual(["c", "b", "a"]);
	});

	it("handles single element", () => {
		expect(dedupeStrings(["only"])).toEqual(["only"]);
	});
});

describe("sanitizeAsi — deep nesting", () => {
	it("sanitizes nested arrays", () => {
		const result = sanitizeAsi({ items: ["a", ["b", "c"]] });
		expect(result).toEqual({ items: ["a", ["b", "c"]] });
	});

	it("sanitizes objects with undefined values (filters them out)", () => {
		const result = sanitizeAsi({ key: undefined });
		expect(result).toBeUndefined(); // empty object after filtering
	});

	it("sanitizes mixed nested structures", () => {
		const result = sanitizeAsi({
			data: { count: 5, label: "test", extra: null },
		});
		expect(result).toEqual({
			data: { count: 5, label: "test", extra: null },
		});
	});

	it("filters __proto__ in nested objects", () => {
		const result = sanitizeAsi({ nested: { __proto__: "bad", valid: "yes" } });
		expect(result).toEqual({ nested: { valid: "yes" } });
	});

	it("handles arrays with undefined entries", () => {
		const result = sanitizeAsi({ items: [1, undefined, 3] });
		expect(result).toEqual({ items: [1, 3] });
	});
});
