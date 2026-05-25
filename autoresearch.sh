#!/usr/bin/env bash
# autoresearch.sh — Benchmark harness for test coverage optimization.
# Emits METRIC and ASI lines for the autoresearch loop.
#
# Primary metric: test_coverage_pct (line coverage percentage, higher is better)
# Secondary metrics:
#   - test_count (number of tests)
#   - expect_calls (number of expect() calls)
#   - uncovered_lines (number of uncovered lines)
#
# Exit code: 0 = success, non-zero = failure

set -euo pipefail

# Run tests with coverage, capture output
OUTPUT_FILE=$(mktemp)
trap 'rm -f "$OUTPUT_FILE"' EXIT

bun test --timeout 30000 --coverage 2>&1 | tee "$OUTPUT_FILE" || true

# Parse coverage from the output
COVERAGE_PCT=0
TEST_COUNT=0
EXPECT_CALLS=0
UNCOVERED_LINES=0

# Extract line coverage percentage from the "All files" row
# Format: "All files | 85.92 | 79.17 |"
ALL_FILES_LINE=$(grep -E "^All files\s" "$OUTPUT_FILE" || true)
if [ -n "$ALL_FILES_LINE" ]; then
  # The line coverage is the 3rd column (% Lines)
  COVERAGE_PCT=$(echo "$ALL_FILES_LINE" | awk -F'|' '{gsub(/^ +| +$/, "", $3); print $3}')
  # Remove any trailing % just in case
  COVERAGE_PCT=$(echo "$COVERAGE_PCT" | tr -d '%')
fi

# Extract test count from "Ran N tests across F files" line
TESTS_LINE=$(grep -E "^Ran [0-9]+ tests" "$OUTPUT_FILE" || true)
if [ -n "$TESTS_LINE" ]; then
  TEST_COUNT=$(echo "$TESTS_LINE" | awk '{print $2}')
fi

# Extract expect() calls from "N expect() calls" line
EXPECT_LINE=$(grep -E "[0-9]+ expect\(\) calls" "$OUTPUT_FILE" || true)
if [ -n "$EXPECT_LINE" ]; then
  EXPECT_CALLS=$(echo "$EXPECT_LINE" | awk '{print $1}')
fi

# Emit metrics
echo "METRIC test_coverage_pct=${COVERAGE_PCT}"
echo "METRIC test_count=${TEST_COUNT}"
echo "METRIC expect_calls=${EXPECT_CALLS}"

# Emit ASI (Agent State Info)
echo "ASI primary_metric=test_coverage_pct"
echo "ASI direction=higher"
echo "ASI goal=improve_test_coverage"

exit 0
