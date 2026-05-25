#!/usr/bin/env bash
# autoresearch.sh — Benchmark harness for test coverage
# Emits METRIC and ASI lines for the autoresearch loop.
#
# Primary metric: line_coverage_percent (0-100, higher is better)

set -euo pipefail

# Run tests with coverage, capturing output
OUTPUT=$(bun test --coverage --timeout 30000 2>&1)
EXIT_CODE=$?

# Extract overall line coverage from the summary table
LINE_COVERAGE=$(echo "$OUTPUT" | grep '^All files' | awk '{print $3}' | tr -d ' ' || echo "0")
FUNC_COVERAGE=$(echo "$OUTPUT" | grep '^All files' | awk '{print $2}' | tr -d ' ' || echo "0")

# Remove trailing % if present
LINE_COVERAGE=$(echo "$LINE_COVERAGE" | tr -d '%')
FUNC_COVERAGE=$(echo "$FUNC_COVERAGE" | tr -d '%')

# Count tests passed/failed
TESTS_PASS=$(echo "$OUTPUT" | grep -E '^\s+[0-9]+ pass' | awk '{print $1}' || echo "0")
TESTS_FAIL=$(echo "$OUTPUT" | grep -E '^\s+[0-9]+ fail' | awk '{print $1}' || echo "0")

# If we can't parse coverage, default to 0
if [[ -z "$LINE_COVERAGE" || "$LINE_COVERAGE" == "0" ]]; then
    LINE_COVERAGE="0"
fi

if [[ -z "$FUNC_COVERAGE" || "$FUNC_COVERAGE" == "0" ]]; then
    FUNC_COVERAGE="0"
fi

# Emit metrics
echo "METRIC line_coverage_percent=${LINE_COVERAGE}"
echo "METRIC func_coverage_percent=${FUNC_COVERAGE}"
echo "METRIC tests_pass=${TESTS_PASS}"
echo "METRIC tests_fail=${TESTS_FAIL}"

# Emit ASI
echo "ASI primary_metric=line_coverage_percent"
echo "ASI direction=higher"
echo "ASI goal=improve_test_coverage_to_100_percent"
echo "ASI tests_pass=${TESTS_PASS}"
echo "ASI tests_fail=${TESTS_FAIL}"
echo "ASI line_coverage=${LINE_COVERAGE}"
echo "ASI func_coverage=${FUNC_COVERAGE}"

exit ${EXIT_CODE}
