# Configuration

## opencode.json

Add the plugin to your `opencode.json`:

```json
{
  "plugin": ["@mittalsuraj18/opencode-auto-research"]
}
```

No additional configuration is required. The plugin auto-detects:
- Current git branch
- Project directory
- Available models (for compaction)

## Environment Variables

The plugin uses these environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `HOME` | Used to locate `~/.opencode-autoresearch/` | `/tmp` |

## Storage Locations

### SQLite Database
```
~/.opencode-autoresearch/<encoded-project-path>.db
```

Example:
```
~/.opencode-autoresearch/%2FUsers%2Fsuraj%2Fproject.db
```

### Benchmark Logs
```
~/.opencode-autoresearch/<project>/runs/<run-id>/benchmark.log
```

### Experiment Markdown
```
./autoresearch.md  (in project root)
```

## Scope Configuration

### scope_paths
Restrict which files the agent can modify:
```typescript
init_experiment({
  scope_paths: ["src/", "lib/"],
  // Agent can only modify files under src/ and lib/
})
```

### off_limits
Prevent modification of specific files:
```typescript
init_experiment({
  off_limits: ["src/types.ts", "package.json"],
  // Agent cannot modify these files
})
```

### constraints
Add custom constraints (stored in session metadata):
```typescript
init_experiment({
  constraints: ["don't change public API", "keep backward compatibility"]
})
```

## Benchmark Harness

### Creating autoresearch.sh

Create a file named `autoresearch.sh` in your project root:

```bash
#!/bin/bash
# Example: Measure test coverage
set -euo pipefail

# Run tests and capture coverage
bun test --coverage > test_output.txt 2>&1

# Parse coverage percentage
coverage=$(grep -oE '[0-9]+\.[0-9]+%' test_output.txt | head -1 | sed 's/%//')

# Output metric
METRIC test_coverage_pct=$coverage

# Optional ASI
ASI test_count=$(grep -c "test(" test_output.txt || echo "0")
```

### Metric Format
```
METRIC <name>=<numeric_value>
```
- One metric per line
- Numeric values only (integers or floats)
- The primary metric must match the `primary_metric` parameter from `init_experiment`

### ASI Format
```
ASI <key>=<string_value>
```
- Used for agent state tracking
- Common keys: `hypothesis`, `next_action_hint`, `rollback_reason`

### Exit Codes
- `0`: Benchmark succeeded, metrics valid
- Non-zero: Benchmark failed, run marked as error

## Git Configuration

### Branch Naming
Branches are automatically named:
```
autoresearch/<goal-slug>-<YYYYMMDD>
```

Example:
```
autoresearch/reduce-compile-time-20260525
```

### Manual Branch Switching
You can manually switch to an autoresearch branch:
```bash
git checkout autoresearch/reduce-compile-time-20260525
```

The plugin will detect the active session for that branch on startup.

## Max Iterations

Default: 10 runs per segment. Override with:
```typescript
init_experiment({
  max_iterations: 5  // Stop after 5 runs
})
```

When max iterations is reached:
- Autoresearch mode is disabled
- The session remains in the database
- The user must start a new experiment to continue
