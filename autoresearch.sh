#!/usr/bin/env bash
# autoresearch.sh — Benchmark harness for codebase documentation quality.
# Emits METRIC and ASI lines for the autoresearch loop.
#
# Primary metric: doc_score (composite 0-100, higher is better)
# Secondary metrics:
#   - jsdoc_coverage_score (0-25)
#   - file_header_score (0-25)
#   - inline_comment_score (0-25)
#   - type_doc_score (0-25)
#
# Exit code: 0 = success, non-zero = failure

set -euo pipefail

SRC_DIR="src"
README="README.md"
PKG="package.json"

# Ensure src directory exists
if [[ ! -d "$SRC_DIR" ]]; then
  echo "METRIC doc_score=0"
  echo "ASI error=src_dir_missing"
  exit 1
fi

# Count total TypeScript source files (excluding tests)
TOTAL_FILES=0
for file in $(find "$SRC_DIR" -name "*.ts" -not -name "*.test.ts" -not -name "*.spec.ts" | sort); do
  TOTAL_FILES=$((TOTAL_FILES + 1))
done

if [[ "$TOTAL_FILES" -eq 0 ]]; then
  echo "METRIC doc_score=0"
  echo "ASI error=no_ts_files"
  exit 1
fi

# Initialize counters
TOTAL_EXPORTED=0
EXPORTED_WITH_JSDOC=0
FILES_WITH_HEADER=0
TOTAL_COMMENT_LINES=0
TOTAL_CODE_LINES=0

# Process each file
for file in $(find "$SRC_DIR" -name "*.ts" -not -name "*.test.ts" -not -name "*.spec.ts" | sort); do
  content=$(cat "$file")
  lines=$(wc -l < "$file" | tr -d ' ')
  
  # File header documentation (first 5 lines contain descriptive comment)
  header=$(head -n 5 "$file")
  has_comment=$(echo "$header" | grep -cE '^[[:space:]]*(\/\/|\/\*\*)' || true)
  if [[ "$has_comment" -gt 0 ]]; then
    # Check if header has a meaningful description
    meaningful=$(echo "$header" | grep -ciE 'description|purpose|overview|summary|documentation|doc|provides|implements|handles|manages' || true)
    if [[ "$meaningful" -gt 0 ]]; then
      FILES_WITH_HEADER=$((FILES_WITH_HEADER + 1))
    fi
  fi
  
  # Count comment lines
  comment_lines=$(grep -cE '^[[:space:]]*(\/\/|\/\*\*)' "$file" || true)
  TOTAL_COMMENT_LINES=$((TOTAL_COMMENT_LINES + comment_lines))
  
  # Count code lines
  code_lines=$(grep -cE '^[[:space:]]*(export|import|function|const|let|var|type|interface|class|if|for|while|switch|return)' "$file" || true)
  TOTAL_CODE_LINES=$((TOTAL_CODE_LINES + code_lines))
  
  # Count exported functions
  exported_funcs=$(grep -cE '^[[:space:]]*export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+[a-zA-Z_]' "$file" || true)
  TOTAL_EXPORTED=$((TOTAL_EXPORTED + exported_funcs))
  
  # Count JSDoc blocks (/** at start of line)
  jsdoc_blocks=$(grep -cE '^[[:space:]]*\/\*\*' "$file" || true)
  EXPORTED_WITH_JSDOC=$((EXPORTED_WITH_JSDOC + jsdoc_blocks))
done

# Cap JSDOC count at exported functions count
if [[ "$EXPORTED_WITH_JSDOC" -gt "$TOTAL_EXPORTED" ]]; then
  EXPORTED_WITH_JSDOC=$TOTAL_EXPORTED
fi

# Calculate file header score (0-25)
FILE_HEADER_SCORE=0
if [[ "$TOTAL_FILES" -gt 0 ]]; then
  header_ratio=$((FILES_WITH_HEADER * 100 / TOTAL_FILES))
  if [[ "$header_ratio" -ge 20 ]]; then FILE_HEADER_SCORE=5; fi
  if [[ "$header_ratio" -ge 40 ]]; then FILE_HEADER_SCORE=10; fi
  if [[ "$header_ratio" -ge 60 ]]; then FILE_HEADER_SCORE=15; fi
  if [[ "$header_ratio" -ge 80 ]]; then FILE_HEADER_SCORE=20; fi
  if [[ "$header_ratio" -ge 95 ]]; then FILE_HEADER_SCORE=25; fi
fi

# Calculate JSDoc coverage score (0-25)
JSDOC_SCORE=0
if [[ "$TOTAL_EXPORTED" -gt 0 ]]; then
  jsdoc_ratio=$((EXPORTED_WITH_JSDOC * 100 / TOTAL_EXPORTED))
  if [[ "$jsdoc_ratio" -ge 20 ]]; then JSDOC_SCORE=5; fi
  if [[ "$jsdoc_ratio" -ge 40 ]]; then JSDOC_SCORE=10; fi
  if [[ "$jsdoc_ratio" -ge 60 ]]; then JSDOC_SCORE=15; fi
  if [[ "$jsdoc_ratio" -ge 80 ]]; then JSDOC_SCORE=20; fi
  if [[ "$jsdoc_ratio" -ge 95 ]]; then JSDOC_SCORE=25; fi
fi

# Calculate inline comment score (0-25)
INLINE_COMMENT_SCORE=0
comment_ratio=0
if [[ "$TOTAL_CODE_LINES" -gt 0 ]]; then
  comment_ratio=$((TOTAL_COMMENT_LINES * 100 / TOTAL_CODE_LINES))
  if [[ "$comment_ratio" -ge 5 ]]; then INLINE_COMMENT_SCORE=5; fi
  if [[ "$comment_ratio" -ge 10 ]]; then INLINE_COMMENT_SCORE=10; fi
  if [[ "$comment_ratio" -ge 15 ]]; then INLINE_COMMENT_SCORE=15; fi
  if [[ "$comment_ratio" -ge 20 ]]; then INLINE_COMMENT_SCORE=20; fi
  if [[ "$comment_ratio" -ge 25 ]]; then INLINE_COMMENT_SCORE=25; fi
fi

# Calculate type documentation score (0-25)
TOTAL_TYPES=0
TYPED_TYPES=0
TYPE_DOC_SCORE=0

# Count interfaces and types - use || true to prevent exit on no matches
TOTAL_TYPES=$(find "$SRC_DIR" -name "*.ts" -not -name "*.test.ts" -exec grep -HE '^[[:space:]]*(export[[:space:]]+)?(interface|type)[[:space:]]+[a-zA-Z_]' {} + 2>/dev/null | wc -l | tr -d ' ' || true)
TYPED_TYPES=$(find "$SRC_DIR" -name "*.ts" -not -name "*.test.ts" -exec grep -HE '^[[:space:]]*\/\*\*' {} + 2>/dev/null | wc -l | tr -d ' ' || true)

# Ensure numeric values
TOTAL_TYPES=${TOTAL_TYPES:-0}
TYPED_TYPES=${TYPED_TYPES:-0}

if [[ "$TOTAL_TYPES" -gt 0 ]]; then
  type_doc_ratio=$((TYPED_TYPES * 100 / TOTAL_TYPES))
  if [[ "$type_doc_ratio" -ge 20 ]]; then TYPE_DOC_SCORE=5; fi
  if [[ "$type_doc_ratio" -ge 40 ]]; then TYPE_DOC_SCORE=10; fi
  if [[ "$type_doc_ratio" -ge 60 ]]; then TYPE_DOC_SCORE=15; fi
  if [[ "$type_doc_ratio" -ge 80 ]]; then TYPE_DOC_SCORE=20; fi
  if [[ "$type_doc_ratio" -ge 95 ]]; then TYPE_DOC_SCORE=25; fi
fi

# Composite score
DOC_SCORE=$((FILE_HEADER_SCORE + JSDOC_SCORE + INLINE_COMMENT_SCORE + TYPE_DOC_SCORE))

# Emit metrics
echo "METRIC doc_score=${DOC_SCORE}"
echo "METRIC file_header_score=${FILE_HEADER_SCORE}"
echo "METRIC jsdoc_coverage_score=${JSDOC_SCORE}"
echo "METRIC inline_comment_score=${INLINE_COMMENT_SCORE}"
echo "METRIC type_doc_score=${TYPE_DOC_SCORE}"
echo "METRIC total_files=${TOTAL_FILES}"
echo "METRIC files_with_headers=${FILES_WITH_HEADER}"
echo "METRIC total_exported_functions=${TOTAL_EXPORTED}"
echo "METRIC exported_with_jsdoc=${EXPORTED_WITH_JSDOC}"
echo "METRIC total_comment_lines=${TOTAL_COMMENT_LINES}"
echo "METRIC total_code_lines=${TOTAL_CODE_LINES}"
echo "METRIC total_types=${TOTAL_TYPES}"
echo "METRIC typed_types=${TYPED_TYPES}"

# Emit ASI
echo "ASI primary_metric=doc_score"
echo "ASI direction=higher"
echo "ASI goal=improve_codebase_documentation"
echo "ASI total_files=${TOTAL_FILES}"
echo "ASI files_with_headers=${FILES_WITH_HEADER}"
echo "ASI total_exported_functions=${TOTAL_EXPORTED}"
echo "ASI exported_with_jsdoc=${EXPORTED_WITH_JSDOC}"
echo "ASI total_comment_lines=${TOTAL_COMMENT_LINES}"
echo "ASI total_code_lines=${TOTAL_CODE_LINES}"
echo "ASI comment_ratio=${comment_ratio}"
echo "ASI total_types=${TOTAL_TYPES}"
echo "ASI typed_types=${TYPED_TYPES}"

exit 0
