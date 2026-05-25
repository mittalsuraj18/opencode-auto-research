# Examples

## Basic Usage

### 1. Optimize Compile Time

**autoresearch.sh**:
```bash
#!/bin/bash
set -euo pipefail

# Measure TypeScript compilation time
start=$(date +%s%3N)
bun run build
end=$(date +%s%3N)

duration=$((end - start))
METRIC compile_time_ms=$duration
ASI build_command="bun run build"
```

**Experiment flow**:
```typescript
// Initialize
init_experiment({
  name: "compile-time-optimization",
  goal: "Reduce TypeScript compilation time",
  primary_metric: "compile_time_ms",
  direction: "lower",
  scope_paths: ["src/", "tsconfig.json"]
})

// Run baseline
run_experiment()

// Log baseline
log_experiment({
  metric: 1200,
  status: "keep",
  description: "Baseline compilation time"
})

// Agent makes optimizations, then:
run_experiment()
log_experiment({
  metric: 950,
  status: "keep",
  description: "Removed unused type imports"
})
```

### 2. Improve Test Coverage

**autoresearch.sh**:
```bash
#!/bin/bash
set -euo pipefail

# Run tests with coverage
bun test --coverage > output.txt 2>&1 || true

# Extract coverage percentage
coverage=$(grep -oE '[0-9]+\.[0-9]+%' output.txt | head -1 | sed 's/%//')

METRIC test_coverage_pct=${coverage:-0}
ASI test_count=$(grep -c "passed" output.txt || echo "0")
```

**Experiment flow**:
```typescript
init_experiment({
  name: "coverage-improvement",
  goal: "Increase test coverage to 90%+",
  primary_metric: "test_coverage_pct",
  direction: "higher",
  scope_paths: ["src/", "test/"]
})

run_experiment()
log_experiment({
  metric: 67.5,
  status: "keep",
  description: "Baseline coverage"
})

// Agent adds tests for uncovered modules...
run_experiment()
log_experiment({
  metric: 89.2,
  status: "keep",
  description: "Added tests for git.ts and helpers.ts"
})
```

### 3. Reduce Bundle Size

**autoresearch.sh**:
```bash
#!/bin/bash
set -euo pipefail

# Build and measure bundle
bun run build

# Get bundle size
size=$(wc -c < dist/index.js)
METRIC bundle_size_bytes=$size

# Count dependencies
deps=$(grep -c "import" dist/index.js || echo "0")
METRIC dependency_count=$deps

ASI build_time=$(date +%s)
```

## Advanced Patterns

### Using Scope Restrictions
```typescript
init_experiment({
  name: "api-cleanup",
  goal: "Clean up internal APIs without breaking public interface",
  primary_metric: "bundle_size_bytes",
  direction: "lower",
  scope_paths: ["src/internal/"],
  off_limits: ["src/public-api.ts", "package.json"]
})
```

### Multi-Segment Experiments
```typescript
// First segment: baseline optimization
init_experiment({
  name: "performance-tuning",
  primary_metric: "latency_ms",
  direction: "lower"
})

// ... run experiments in segment 0 ...

// Start fresh segment for different approach
init_experiment({
  name: "performance-tuning-v2",
  primary_metric: "latency_ms",
  direction: "lower",
  new_segment: true  // Archives segment 0 results
})
```

### Using Constraints
```typescript
init_experiment({
  name: "refactoring",
  goal: "Simplify code structure",
  primary_metric: "complexity_score",
  direction: "lower",
  constraints: [
    "don't change public API",
    "keep backward compatibility",
    "maintain test coverage above 80%"
  ]
})
```

### With Notes
```typescript
init_experiment({
  name: "algorithm-optimization",
  primary_metric: "execution_time_ms",
  direction: "lower"
})

run_experiment()
log_experiment({
  metric: 500,
  status: "discard",
  description: "Tried memoization, no improvement"
})

update_notes({
  append_idea: "Try using a trie instead of hash map"
})

// Agent reads notes and tries the new approach
run_experiment()
log_experiment({
  metric: 320,
  status: "keep",
  description: "Trie implementation reduced lookup time"
})
```

### Handling Crashes
```typescript
run_experiment()
// Benchmark crashes (exit code 1)

log_experiment({
  metric: 0,
  status: "crash",
  description: "Build failed after removing dependency",
  justification: "Missing import caused compilation error"
})

// Fix the issue
// ...

run_experiment()
log_experiment({
  metric: 450,
  status: "keep",
  description: "Fixed import and optimized"
})
```

## Command Line Usage

### Using the /autoresearch Command
```
/autoresearch optimize compile time
```

This automatically:
1. Creates `autoresearch.sh` if missing
2. Calls `init_experiment` with appropriate parameters
3. Runs the baseline
4. Logs it as `keep`
5. Starts the optimization loop

### Resuming an Experiment
```
/autoresearch
```

Without a goal, it resumes the existing experiment.

### Changing Goals
```
/autoresearch reduce bundle size
```

If an experiment is active, it updates the goal and continues.

## Real-World Scenarios

### Scenario 1: Refactoring Legacy Code
```bash
# Create benchmark that measures complexity
autoresearch.sh:
```
```bash
#!/bin/bash
# Count lines of code and cyclomatic complexity
loc=$(find src -name "*.ts" -not -name "*.test.ts" | xargs wc -l | tail -1 | awk '{print $1}')
complexity=$(grep -r "if\|while\|for\|case" src --include="*.ts" | wc -l)
METRIC complexity_score=$complexity
METRIC lines_of_code=$loc
```

### Scenario 2: Dependency Update
```bash
# Benchmark that checks for vulnerabilities and bundle impact
autoresearch.sh:
```
```bash
#!/bin/bash
# Check bundle size after npm update
npm update
bun run build
size=$(wc -c < dist/index.js)
vulns=$(npm audit --json 2>/dev/null | grep -c "severity" || echo "0")
METRIC bundle_size_bytes=$size
METRIC vulnerability_count=$vulns
```

### Scenario 3: Documentation Coverage
```bash
# Measure documentation quality
autoresearch.sh:
```
```bash
#!/bin/bash
# Count JSDoc coverage
total_funcs=$(grep -r "^export function" src --include="*.ts" | wc -l)
documented=$(grep -r "^\s*/\*\*" src --include="*.ts" | wc -l)
coverage=$((documented * 100 / total_funcs))
METRIC doc_coverage_pct=$coverage
```

## Tips and Best Practices

1. **Keep benchmarks fast**: Aim for under 60 seconds to maintain iteration speed
2. **Make metrics deterministic**: Use fixed inputs, avoid network calls
3. **Log early and often**: Call `log_experiment` immediately after `run_experiment`
4. **Use ASI for context**: Include `hypothesis` and `next_action_hint` in ASI
5. **Scope appropriately**: Use `scope_paths` to prevent unintended modifications
6. **Track secondary metrics**: Capture related metrics for context
7. **Use notes for hypotheses**: `update_notes` helps track what you've tried

## Common Benchmark Templates

### TypeScript Project
```bash
#!/bin/bash
set -euo pipefail
start=$(date +%s%3N)
npx tsc --noEmit
end=$(date +%s%3N)
METRIC compile_time_ms=$((end - start))
```

### Node.js/Bun Project
```bash
#!/bin/bash
set -euo pipefail
start=$(date +%s%3N)
bun run build
end=$(date +%s%3N)
size=$(wc -c < dist/index.js)
METRIC build_time_ms=$((end - start))
METRIC bundle_size_bytes=$size
```

### Web Performance
```bash
#!/bin/bash
set -euo pipefail
# Build and measure with Lighthouse (example)
npm run build
lighthouse http://localhost:3000 --output=json > report.json
score=$(cat report.json | jq '.categories.performance.score * 100')
METRIC lighthouse_score=$score
```
