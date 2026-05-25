#!/usr/bin/env bash
# autoresearch.sh — Benchmark harness for WIKI completeness
# Emits METRIC and ASI lines for the autoresearch loop.
#
# Primary metric: wiki_completeness_score (0-100, higher is better)
# Checks for required WIKI pages and their quality

set -euo pipefail

WIKI_DIR="wiki"
SCORE=0
MAX_SCORE=100

# Check if wiki directory exists
if [[ -d "$WIKI_DIR" ]]; then
    # Points for having wiki directory (10 points)
    SCORE=$((SCORE + 10))
fi

# Define required wiki pages as a list
PAGES=(overview architecture tools configuration development troubleshooting contributing changelog examples)

# Check for each page
TOTAL_PAGES=0
EXISTING_PAGES=0
TOTAL_LENGTH=0
for page in "${PAGES[@]}"; do
    TOTAL_PAGES=$((TOTAL_PAGES + 1))
    filepath="$WIKI_DIR/$page.md"
    if [[ -f "$filepath" ]]; then
        EXISTING_PAGES=$((EXISTING_PAGES + 1))
        # Add points for existence (10 points per page)
        SCORE=$((SCORE + 10))
        
        # Check content length (bonus points for substantial content)
        length=$(wc -l < "$filepath" | tr -d ' ')
        TOTAL_LENGTH=$((TOTAL_LENGTH + length))
        
        # Bonus points for content over 20 lines
        if [[ $length -gt 20 ]]; then
            SCORE=$((SCORE + 2))
        fi
        
        # Bonus points for code examples (fenced code blocks)
        code_blocks=$(grep -c '^```' "$filepath" || true)
        if [[ $code_blocks -gt 0 ]]; then
            SCORE=$((SCORE + 2))
        fi
    fi
done

# Cap score at MAX_SCORE
if [[ $SCORE -gt $MAX_SCORE ]]; then
    SCORE=$MAX_SCORE
fi

# Emit metrics
echo "METRIC wiki_completeness_score=${SCORE}"
echo "METRIC total_pages=${TOTAL_PAGES}"
echo "METRIC existing_pages=${EXISTING_PAGES}"
echo "METRIC total_lines=${TOTAL_LENGTH}"

# Emit ASI
echo "ASI primary_metric=wiki_completeness_score"
echo "ASI direction=higher"
echo "ASI goal=create_complete_wiki"
echo "ASI total_pages=${TOTAL_PAGES}"
echo "ASI existing_pages=${EXISTING_PAGES}"
echo "ASI total_lines=${TOTAL_LENGTH}"

exit 0
