#!/usr/bin/env bash
# autoresearch.sh — Benchmark harness for README SEO optimization.
# Emits METRIC and ASI lines for the autoresearch loop.
#
# Primary metric: seo_score (composite 0-100, higher is better)
# Secondary metrics:
#   - heading_structure_score (0-25)
#   - content_depth_score (0-25)
#   - keyword_richness_score (0-25)
#   - technical_seo_score (0-25)
#
# Exit code: 0 = success, non-zero = failure

set -euo pipefail

README="README.md"
PKG="package.json"

# Ensure README exists
if [[ ! -f "$README" ]]; then
  echo "METRIC seo_score=0"
  echo "ASI error=readme_missing"
  exit 1
fi

# Read content
CONTENT=$(cat "$README")
LINES=$(echo "$CONTENT" | wc -l | tr -d ' ')
WORDS=$(echo "$CONTENT" | wc -w | tr -d ' ')

# Count headings
H1_COUNT=$(echo "$CONTENT" | grep -c '^# ' || true)
H2_COUNT=$(echo "$CONTENT" | grep -c '^## ' || true)
H3_COUNT=$(echo "$CONTENT" | grep -c '^### ' || true)
TOTAL_HEADINGS=$((H1_COUNT + H2_COUNT + H3_COUNT))

# Check for key sections
HAS_INSTALLATION=$(echo "$CONTENT" | grep -ciE 'install|getting started|quick start' || true)
HAS_USAGE=$(echo "$CONTENT" | grep -ciE 'usage|example|how to|quick start' || true)
HAS_FEATURES=$(echo "$CONTENT" | grep -ciE 'feature|overview|what' || true)
HAS_LICENSE=$(echo "$CONTENT" | grep -ciE 'license|licence' || true)
HAS_LINKS=$(echo "$CONTENT" | grep -cE '\[.*\]\(.*\)' || true)
HAS_BADGES=$(echo "$CONTENT" | grep -cE '!\[.*\]\(.*\)' || true)
HAS_CODE_BLOCKS=$(echo "$CONTENT" | grep -c '^\s*\`\`\`' || true)
HAS_TABLE=$(echo "$CONTENT" | grep -cE '^\|.*\|' || true)
HAS_TOC=$(echo "$CONTENT" | grep -ciE 'table of contents|toc|contents' || true)

# Keyword analysis - target keywords for an opencode plugin
KEYWORDS=("opencode" "plugin" "autoresearch" "benchmark" "optimize" "experiment" "automated")
KEYWORD_SCORE=0
for kw in "${KEYWORDS[@]}"; do
  COUNT=$(echo "$CONTENT" | grep -ci "$kw" || true)
  if [[ "$COUNT" -gt 0 ]]; then
    KEYWORD_SCORE=$((KEYWORD_SCORE + 1))
  fi
done

# Package.json keywords
PKG_KEYWORDS=0
if [[ -f "$PKG" ]]; then
  PKG_KEYWORDS=$(grep -c '"keywords"' "$PKG" || true)
fi

# --- Compute sub-scores ---

# Heading structure (0-25)
HEADING_SCORE=0
[[ "$H1_COUNT" -ge 1 ]] && HEADING_SCORE=$((HEADING_SCORE + 5))
[[ "$H2_COUNT" -ge 3 ]] && HEADING_SCORE=$((HEADING_SCORE + 5))
[[ "$H3_COUNT" -ge 2 ]] && HEADING_SCORE=$((HEADING_SCORE + 5))
[[ "$TOTAL_HEADINGS" -ge 5 ]] && HEADING_SCORE=$((HEADING_SCORE + 5))
[[ "$HAS_TOC" -gt 0 ]] && HEADING_SCORE=$((HEADING_SCORE + 5))

# Content depth (0-25)
DEPTH_SCORE=0
[[ "$WORDS" -ge 100 ]] && DEPTH_SCORE=$((DEPTH_SCORE + 5))
[[ "$WORDS" -ge 300 ]] && DEPTH_SCORE=$((DEPTH_SCORE + 5))
[[ "$WORDS" -ge 500 ]] && DEPTH_SCORE=$((DEPTH_SCORE + 5))
[[ "$HAS_CODE_BLOCKS" -gt 0 ]] && DEPTH_SCORE=$((DEPTH_SCORE + 5))
[[ "$HAS_TABLE" -gt 0 ]] && DEPTH_SCORE=$((DEPTH_SCORE + 5))

# Keyword richness (0-25)
KEYWORD_RICHNESS=$((KEYWORD_SCORE * 3))
[[ "$KEYWORD_RICHNESS" -gt 25 ]] && KEYWORD_RICHNESS=25
[[ "$PKG_KEYWORDS" -gt 0 ]] && KEYWORD_RICHNESS=$((KEYWORD_RICHNESS + 5))
[[ "$KEYWORD_RICHNESS" -gt 25 ]] && KEYWORD_RICHNESS=25

# Technical SEO (0-25)
TECH_SCORE=0
[[ "$HAS_INSTALLATION" -gt 0 ]] && TECH_SCORE=$((TECH_SCORE + 5))
[[ "$HAS_USAGE" -gt 0 ]] && TECH_SCORE=$((TECH_SCORE + 5))
[[ "$HAS_FEATURES" -gt 0 ]] && TECH_SCORE=$((TECH_SCORE + 5))
[[ "$HAS_LICENSE" -gt 0 ]] && TECH_SCORE=$((TECH_SCORE + 5))
[[ "$HAS_LINKS" -gt 0 ]] && TECH_SCORE=$((TECH_SCORE + 5))

# Composite score
SEO_SCORE=$((HEADING_SCORE + DEPTH_SCORE + KEYWORD_RICHNESS + TECH_SCORE))

# Emit metrics
echo "METRIC seo_score=${SEO_SCORE}"
echo "METRIC heading_structure_score=${HEADING_SCORE}"
echo "METRIC content_depth_score=${DEPTH_SCORE}"
echo "METRIC keyword_richness_score=${KEYWORD_RICHNESS}"
echo "METRIC technical_seo_score=${TECH_SCORE}"
echo "METRIC word_count=${WORDS}"
echo "METRIC heading_count=${TOTAL_HEADINGS}"

# Emit ASI
echo "ASI primary_metric=seo_score"
echo "ASI direction=higher"
echo "ASI goal=improve_readme_seo"
echo "ASI h1_count=${H1_COUNT}"
echo "ASI h2_count=${H2_COUNT}"
echo "ASI h3_count=${H3_COUNT}"
echo "ASI has_installation=${HAS_INSTALLATION}"
echo "ASI has_usage=${HAS_USAGE}"
echo "ASI has_features=${HAS_FEATURES}"
echo "ASI has_license=${HAS_LICENSE}"
echo "ASI has_links=${HAS_LINKS}"
echo "ASI has_badges=${HAS_BADGES}"
echo "ASI has_code_blocks=${HAS_CODE_BLOCKS}"
echo "ASI has_table=${HAS_TABLE}"
echo "ASI has_toc=${HAS_TOC}"
echo "ASI pkg_keywords=${PKG_KEYWORDS}"
echo "ASI keyword_matches=${KEYWORD_SCORE}"

exit 0
