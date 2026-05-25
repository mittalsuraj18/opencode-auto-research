import { describe, expect, it } from "bun:test";
import {
	computeRunModifiedPaths,
	dedupeStrings,
	ensureNumericMetricMap,
	formatElapsed,
	formatNum,
	inferMetricUnitFromName,
	isBetter,
	normalizePathSpec,
	parseAsiLine,
	parseBenchmarkOutput,
	parseDirtyPaths,
	parseMetricLine,
	parseWorkDirDirtyPaths,
	pathMatchesSpec,
	relativizeGitPathToWorkDir,
	sanitizeAsi,
	truncateOutput,
} from "../../src/helpers";

describe("formatNum", () => {
	it("returns '-' for null", () => {
		expect(formatNum(null, "ms")).toBe("-");
	});

	it("returns '-' for undefined", () => {
		expect(formatNum(undefined, "ms")).toBe("-");
	});

	it("returns '-' for NaN", () => {
		expect(formatNum(NaN, "ms")).toBe("-");
	});

	it("formats microseconds", () => {
		expect(formatNum(1234.567, "µs")).toBe("1234.57µs");
	});

	it("formats milliseconds", () => {
		expect(formatNum(1500, "ms")).toBe("1500.00ms");
	});

	it("formats seconds", () => {
		expect(formatNum(45.5, "s")).toBe("45.50s");
	});

	it("formats kilobytes", () => {
		expect(formatNum(2048, "kb")).toBe("2048.0KB");
	});

	it("formats megabytes", () => {
		expect(formatNum(5.5, "mb")).toBe("5.5MB");
	});

	it("formats with default locale for unknown unit", () => {
		expect(formatNum(1234.567, "")).toBe("1,234.57");
	});
});

describe("formatElapsed", () => {
	it("formats seconds", () => {
		expect(formatElapsed(45000)).toBe("45s");
	});

	it("formats minutes and seconds", () => {
		expect(formatElapsed(125000)).toBe("2m 5s");
	});

	it("formats hours and minutes", () => {
		expect(formatElapsed(7260000)).toBe("2h 1m");
	});

	it("formats zero", () => {
		expect(formatElapsed(0)).toBe("0s");
	});
});

describe("isBetter", () => {
	it("returns true when lower is better and current < best", () => {
		expect(isBetter(5, 10, "lower")).toBe(true);
	});

	it("returns false when lower is better and current > best", () => {
		expect(isBetter(15, 10, "lower")).toBe(false);
	});

	it("returns true when higher is better and current > best", () => {
		expect(isBetter(15, 10, "higher")).toBe(true);
	});

	it("returns false when higher is better and current < best", () => {
		expect(isBetter(5, 10, "higher")).toBe(false);
	});
});

describe("inferMetricUnitFromName", () => {
	it("infers µs", () => {
		expect(inferMetricUnitFromName("latency_µs")).toBe("µs");
	});

	it("infers ms", () => {
		expect(inferMetricUnitFromName("duration_ms")).toBe("ms");
	});

	it("infers s", () => {
		expect(inferMetricUnitFromName("timeout_sec")).toBe("s");
	});

	it("infers kb", () => {
		expect(inferMetricUnitFromName("size_kb")).toBe("kb");
	});

	it("infers mb", () => {
		expect(inferMetricUnitFromName("memory_mb")).toBe("mb");
	});

	it("returns empty for unknown", () => {
		expect(inferMetricUnitFromName("count")).toBe("");
	});
});

describe("normalizePathSpec", () => {
	it("normalizes '.' to '.'", () => {
		expect(normalizePathSpec(".")).toBe(".");
	});

	it("normalizes './' to '.'", () => {
		expect(normalizePathSpec("./")).toBe(".");
	});

	it("removes trailing slashes", () => {
		expect(normalizePathSpec("src/")).toBe("src");
	});

	it("converts backslashes", () => {
		expect(normalizePathSpec("src\\components")).toBe("src/components");
	});

	it("removes leading ./", () => {
		expect(normalizePathSpec("./src")).toBe("src");
	});
});

describe("pathMatchesSpec", () => {
	it("matches exact path", () => {
		expect(pathMatchesSpec("src/index.ts", "src/index.ts")).toBe(true);
	});

	it("matches prefix", () => {
		expect(pathMatchesSpec("src/index.ts", "src")).toBe(true);
	});

	it("'.' matches all", () => {
		expect(pathMatchesSpec("src/index.ts", ".")).toBe(true);
	});

	it("does not match unrelated", () => {
		expect(pathMatchesSpec("src/index.ts", "test")).toBe(false);
	});
});

describe("dedupeStrings", () => {
	it("removes duplicates", () => {
		expect(dedupeStrings(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
	});

	it("trims whitespace", () => {
		expect(dedupeStrings(["  a  ", "b"])).toEqual(["a", "b"]);
	});

	it("removes empty strings", () => {
		expect(dedupeStrings(["", "a", ""])).toEqual(["a"]);
	});

	it("returns empty for empty input", () => {
		expect(dedupeStrings([])).toEqual([]);
	});
});

describe("ensureNumericMetricMap", () => {
	it("returns empty object for undefined", () => {
		expect(ensureNumericMetricMap(undefined)).toEqual({});
	});

	it("filters non-numeric values", () => {
		expect(ensureNumericMetricMap({ a: 1, b: "two", c: 3 })).toEqual({ a: 1, c: 3 });
	});

	it("filters denied keys", () => {
		expect(ensureNumericMetricMap({ __proto__: 1, a: 2 })).toEqual({ a: 2 });
	});

	it("filters NaN and Infinity", () => {
		expect(ensureNumericMetricMap({ a: NaN, b: Infinity, c: 1 })).toEqual({ c: 1 });
	});
});

describe("sanitizeAsi", () => {
	it("returns undefined for undefined input", () => {
		expect(sanitizeAsi(undefined)).toBeUndefined();
	});

	it("sanitizes strings", () => {
		expect(sanitizeAsi({ key: "value" })).toEqual({ key: "value" });
	});

	it("sanitizes numbers", () => {
		expect(sanitizeAsi({ key: 42 })).toEqual({ key: 42 });
	});

	it("sanitizes booleans", () => {
		expect(sanitizeAsi({ key: true })).toEqual({ key: true });
	});

	it("sanitizes null", () => {
		expect(sanitizeAsi({ key: null })).toEqual({ key: null });
	});

	it("sanitizes arrays", () => {
		expect(sanitizeAsi({ key: ["a", 1, true] })).toEqual({ key: ["a", 1, true] });
	});

	it("sanitizes nested objects", () => {
		expect(sanitizeAsi({ key: { nested: "value" } })).toEqual({ key: { nested: "value" } });
	});

	it("filters denied keys", () => {
		expect(sanitizeAsi({ __proto__: "bad", a: "good" })).toEqual({ a: "good" });
	});

	it("returns undefined for empty object", () => {
		expect(sanitizeAsi({})).toBeUndefined();
	});
});

describe("parseMetricLine", () => {
	it("parses valid metric", () => {
		expect(parseMetricLine("METRIC compile_time_ms=1200")).toEqual({ name: "compile_time_ms", value: 1200 });
	});

	it("parses metric with whitespace", () => {
		expect(parseMetricLine("METRIC  compile_time_ms = 1200 ")).toEqual({ name: "compile_time_ms", value: 1200 });
	});

	it("parses negative value", () => {
		expect(parseMetricLine("METRIC delta=-5")).toEqual({ name: "delta", value: -5 });
	});

	it("parses decimal value", () => {
		expect(parseMetricLine("METRIC accuracy=0.95")).toEqual({ name: "accuracy", value: 0.95 });
	});

	it("parses scientific notation", () => {
		expect(parseMetricLine("METRIC large=1.5e10")).toEqual({ name: "large", value: 1.5e10 });
	});

	it("returns null for invalid format", () => {
		expect(parseMetricLine("INVALID format")).toBeNull();
	});

	it("returns null for non-numeric value", () => {
		expect(parseMetricLine("METRIC foo=bar")).toBeNull();
	});
});

describe("parseAsiLine", () => {
	it("parses valid ASI", () => {
		expect(parseAsiLine("ASI hypothesis=reduce allocations")).toEqual({ key: "hypothesis", value: "reduce allocations" });
	});

	it("parses ASI with equals in value", () => {
		expect(parseAsiLine("ASI key=value=with=equals")).toEqual({ key: "key", value: "value=with=equals" });
	});

	it("returns null for invalid format", () => {
		expect(parseAsiLine("INVALID format")).toBeNull();
	});
});

describe("parseBenchmarkOutput", () => {
	it("parses full output and extracts primary metric", () => {
		const output = `METRIC compile_time_ms=1200
METRIC bundle_size_bytes=45000
ASI hypothesis=reduce imports`;
		const result = parseBenchmarkOutput(output, "compile_time_ms");
		expect(result.primaryMetric).toBe(1200);
		expect(result.metrics).toEqual({ compile_time_ms: 1200, bundle_size_bytes: 45000 });
		expect(result.asi).toEqual({ hypothesis: "reduce imports" });
	});

	it("returns null primary when metric not found", () => {
		const output = "METRIC other=100";
		const result = parseBenchmarkOutput(output, "missing");
		expect(result.primaryMetric).toBeNull();
	});

	it("handles empty output", () => {
		const result = parseBenchmarkOutput("", "metric");
		expect(result.primaryMetric).toBeNull();
		expect(result.metrics).toEqual({});
		expect(result.asi).toEqual({});
	});
});

describe("truncateOutput", () => {
	it("returns unchanged when under limits", () => {
		expect(truncateOutput("line1\nline2", 1000, 10)).toBe("line1\nline2");
	});

	it("truncates by lines", () => {
		const output = "a\nb\nc\nd\ne";
		expect(truncateOutput(output, 1000, 3)).toBe("a\nb\nc\n... (2 more lines, 9 total chars) ...");
	});

	it("truncates by chars", () => {
		const output = "a".repeat(5000);
		expect(truncateOutput(output, 10, 100)).toContain("[truncated]");
	});
});

describe("parseDirtyPaths", () => {
	it("parses NUL-terminated status", () => {
		const status = " M\0src/index.ts\0";
		const paths = parseDirtyPaths(status);
		expect(paths).toContain("src/index.ts");
	});

	it("parses line format status", () => {
		const status = " M src/index.ts\n?? src/new.ts";
		const paths = parseDirtyPaths(status);
		expect(paths).toContain("src/index.ts");
		expect(paths).toContain("src/new.ts");
	});

	it("handles renames in line format", () => {
		const status = "R  old.ts -> new.ts";
		const paths = parseDirtyPaths(status);
		expect(paths).toContain("old.ts");
		expect(paths).toContain("new.ts");
	});
});

describe("parseWorkDirDirtyPaths", () => {
	it("filters by workdir prefix", () => {
		const status = " M\0packages/core/src/index.ts\0";
		const paths = parseWorkDirDirtyPaths(status, "packages/core");
		expect(paths).toContain("src/index.ts");
	});

	it("returns empty for non-matching prefix", () => {
		const status = " M\0other/index.ts\0";
		const paths = parseWorkDirDirtyPaths(status, "packages/core");
		expect(paths).toEqual([]);
	});
});

describe("relativizeGitPathToWorkDir", () => {
	it("returns path as-is for empty prefix", () => {
		expect(relativizeGitPathToWorkDir("src/index.ts", "")).toBe("src/index.ts");
	});

	it("relativizes matching prefix", () => {
		expect(relativizeGitPathToWorkDir("packages/core/src/index.ts", "packages/core")).toBe("src/index.ts");
	});

	it("returns null for non-matching prefix", () => {
		expect(relativizeGitPathToWorkDir("other/index.ts", "packages/core")).toBeNull();
	});
});

describe("computeRunModifiedPaths", () => {
	it("detects tracked modifications", () => {
		const preRun = [];
		const current = " M\0src/index.ts\0";
		const result = computeRunModifiedPaths(preRun, current, "");
		expect(result.tracked).toContain("src/index.ts");
		expect(result.untracked).toEqual([]);
	});

	it("detects untracked files", () => {
		const preRun = [];
		const current = "??\0src/new.ts\0";
		const result = computeRunModifiedPaths(preRun, current, "");
		expect(result.untracked).toContain("src/new.ts");
		expect(result.tracked).toEqual([]);
	});

	it("ignores pre-existing dirty paths", () => {
		const preRun = ["src/index.ts"];
		const current = " M\0src/index.ts\0";
		const result = computeRunModifiedPaths(preRun, current, "");
		expect(result.tracked).toEqual([]);
	});
});
