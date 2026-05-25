# Tools Reference

The plugin registers 4 tools that can be called by the agent or directly by the user.

## `init_experiment`

Initialize a new autoresearch experiment session.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Name of the experiment |
| `goal` | `string` | No | What to optimize (e.g., "reduce compile time") |
| `primary_metric` | `string` | Yes | Main metric to track (e.g., `compile_time_ms`) |
| `metric_unit` | `string` | No | Unit suffix (ms, bytes, pct, etc.) |
| `direction` | `"lower" \| "higher"` | Yes | Whether lower or higher values are better |
| `scope_paths` | `string[]` | No | Files/directories the agent may modify |
| `off_limits` | `string[]` | No | Files/directories the agent must NOT modify |
| `max_iterations` | `number` | No | Maximum experiments per segment (default: 10) |
| `new_segment` | `boolean` | No | Start a fresh segment (archives previous runs) |

### Auto-behaviors
- Creates `autoresearch.md` if missing
- Creates `autoresearch/*` branch if not on one
- Auto-commits harness as baseline on autoresearch branch
- Stores session in SQLite database

### Example
```typescript
init_experiment({
  name: "compile-time-optimization",
  goal: "Reduce TypeScript compile time by 20%",
  primary_metric: "compile_time_ms",
  direction: "lower",
  scope_paths: ["src/"],
  max_iterations: 5
})
```

## `run_experiment`

Execute the benchmark harness (`bash autoresearch.sh`).

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `timeout_seconds` | `number` | No | Maximum runtime in seconds (default: 600) |

### Output
- **Parsed metrics** from `METRIC name=value` lines
- **ASI data** from `ASI key=value` lines
- **Truncated raw output** (first 10 lines, max 4KB)
- **Full log** saved to `~/.opencode-autoresearch/<project>/runs/<id>/benchmark.log`

### Exit Codes
- `0` = Success (benchmark completed)
- `1` = Failure (benchmark script error or timeout)

### Example
```typescript
run_experiment({ timeout_seconds: 120 })
```

### Benchmark Harness Format

Your `autoresearch.sh` must print metrics in this format:
```bash
#!/bin/bash
# Run your benchmark...
METRIC compile_time_ms=1200
METRIC bundle_size_bytes=45000
ASI hypothesis=reduced_loop_iterations
ASI next_action_hint=try_unrolling_factor_4
```

## `log_experiment`

Log the result and update experiment state.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `metric` | `number` | Yes | Primary metric value |
| `status` | `"keep" \| "discard" \| "crash" \| "checks_failed"` | Yes | Whether to keep or discard changes |
| `description` | `string` | Yes | What this run tested |
| `metrics` | `Record<string, number>` | No | Additional metrics |
| `asi` | `Record<string, unknown>` | No | Agent state info |
| `justification` | `string` | No | Why this status was chosen |

### Status Values
- **`keep`**: Changes are good, commit them
- **`discard`**: Changes didn't help, revert them
- **`crash`**: Build/test failure, revert changes
- **`checks_failed`**: Preconditions not met, revert changes

### Auto-behaviors
- `keep` on autoresearch branch → commits with formatted message
- `discard`/`crash` on autoresearch branch → `git reset --hard HEAD` + `git clean -fd`
- `discard`/`crash` on other branch → reverts only run-modified files
- Detects scope deviations (files outside `scope_paths` or inside `off_limits`)
- Updates `autoresearch.md`
- Checks `max_iterations`; disables mode if reached

### Example
```typescript
log_experiment({
  metric: 1150,
  status: "keep",
  description: "Removed unused imports",
  metrics: { bundle_size_bytes: 44500 },
  asi: { hypothesis: "dead_code_elimination", next_action_hint: "check_tree_shaking" }
})
```

## `update_notes`

Update experiment notes with ideas or observations.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `body` | `string` | No | Replace entire notes content |
| `append_idea` | `string` | No | Append a bullet point to ideas |

### Example
```typescript
update_notes({
  append_idea: "Try using Bun's transpiler directly instead of tsc"
})
```

## Tool Interactions

### Normal Flow
```
init_experiment → run_experiment → log_experiment (keep/discard)
```

### With Notes
```
init_experiment → run_experiment → log_experiment → update_notes → [repeat]
```

### Recovery After Crash
```
run_experiment (fails) → log_experiment (status: crash) → [fix issue] → run_experiment
```

### Multi-Segment
```
init_experiment (segment 0) → [runs...] → 
init_experiment (new_segment: true, segment 1) → [runs...]
```

## Important Rules

1. **Always log before running again**: If `run_experiment` completed but not logged, you MUST call `log_experiment` before starting a new `run_experiment`
2. **Pending runs are tracked**: The plugin tracks pending runs and warns in the system prompt
3. **Scope enforcement**: Modified files outside `scope_paths` or inside `off_limits` are flagged as deviations
