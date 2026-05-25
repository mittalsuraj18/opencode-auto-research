# @mittalsuraj18/opencode-auto-research

[![npm version](https://img.shields.io/npm/v/@mittalsuraj18/opencode-auto-research.svg)](https://www.npmjs.com/package/@mittalsuraj18/opencode-auto-research)
[![npm downloads](https://img.shields.io/npm/dm/@mittalsuraj18/opencode-auto-research.svg)](https://www.npmjs.com/package/@mittalsuraj18/opencode-auto-research)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub issues](https://img.shields.io/github/issues/mittalsuraj18/opencode-auto-research.svg)](https://github.com/mittalsuraj18/opencode-auto-research/issues)

An [autoresearch](https://github.com/mittalsuraj18/opencode-auto-research) plugin for [OpenCode](https://opencode.ai) that implements an automated benchmark-driven optimization loop.

## Overview

This plugin enables OpenCode agents to systematically optimize code performance through:

1. **Benchmark harness** (`autoresearch.sh`) — measures target metrics
2. **Experiment loop** — modify code, run benchmark, evaluate, keep or discard
3. **Auto-compaction** — context is compacted after every iteration to prevent overflow
4. **Git integration** — commits on keep, resets on discard, dedicated branches

## Installation

```bash
npm install @mittalsuraj18/opencode-auto-research
```

Add to your `opencode.json`:

```json
{
  "plugin": ["@mittalsuraj18/opencode-auto-research"]
}
```

## Quick Start

### Option 1: Direct tool usage

1. Create `autoresearch.sh` in your project root that prints metrics:
   ```bash
   #!/bin/bash
   METRIC compile_time_ms=1200
   METRIC bundle_size_bytes=45000
   ```

2. Call `init_experiment` with your benchmark name and metric
3. Call `run_experiment` to run the baseline
4. Call `log_experiment` with `status: keep` to establish the baseline
5. The agent will auto-iterate, optimizing the metric

## Built-in Command

The plugin registers a `/autoresearch` command automatically. Just type:

```
/autoresearch optimize compile time
```

### What happens

1. If an experiment is already active → **resumes** it with the new goal
2. If no experiment is active → **starts** a new one:
   - Creates `autoresearch.sh` if missing
   - Calls `init_experiment` with an appropriate benchmark name and metric
   - Runs the baseline with `run_experiment`
   - Logs the baseline with `log_experiment keep`
   - The auto-iteration loop begins

### Resume behavior

```
/autoresearch
```

Without a goal, it continues the existing experiment. With a goal, it updates the experiment's goal and continues.

No manual `opencode.json` configuration needed — the command is registered automatically for autocomplete.

## Tools

### `init_experiment`

Initialize a new autoresearch experiment session.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Name of the experiment |
| `goal` | string? | What to optimize |
| `primary_metric` | string | Main metric to track |
| `metric_unit` | string? | Unit (ms, bytes, etc.) |
| `direction` | "lower" \| "higher" | Better direction |
| `scope_paths` | string[]? | Files agent may modify |
| `off_limits` | string[]? | Files agent must NOT modify |
| `max_iterations` | number? | Max experiments per segment |
| `new_segment` | boolean? | Start fresh segment |

**Auto-behaviors:**
- Creates `autoresearch.md` if missing
- Creates `autoresearch/*` branch if not on one
- Auto-commits harness as baseline on autoresearch branch

### `run_experiment`

Run the benchmark harness (`bash autoresearch.sh`).

| Parameter | Type | Description |
|-----------|------|-------------|
| `timeout_seconds` | number? | Max runtime (default: 600) |

**Output:**
- Parsed metrics from `METRIC name=value` lines
- ASI (Agent State Info) from `ASI key=value` lines
- Truncated raw output (4KB / 10 lines max)
- Full log saved to `~/.opencode-autoresearch/<project>/runs/<id>/benchmark.log`

### `log_experiment`

Log the result and update experiment state.

| Parameter | Type | Description |
|-----------|------|-------------|
| `metric` | number | Primary metric value |
| `status` | "keep" \| "discard" \| "crash" \| "checks_failed" | Whether to keep changes |
| `description` | string | What this run tested |
| `metrics` | Record<string, number>? | Additional metrics |
| `asi` | Record<string, unknown>? | Agent state info |
| `justification` | string? | Why this status |

**Auto-behaviors:**
- `keep` on autoresearch branch → commits changes
- `discard`/`crash` on autoresearch branch → `git reset --hard HEAD` + `git clean -fd`
- `discard`/`crash` on other branch → only reverts run-modified files
- Detects scope deviations (modified files outside scope_paths or in off_limits)
- Updates `autoresearch.md`
- Checks max_iterations; disables mode if reached

### `update_notes`

Update experiment notes.

| Parameter | Type | Description |
|-----------|------|-------------|
| `body` | string? | Replace entire notes |
| `append_idea` | string? | Append bullet to ideas |

## Benchmark Harness Format

Your `autoresearch.sh` must print metrics in this format:

```bash
#!/bin/bash
# Run your benchmark here...
METRIC compile_time_ms=1200
METRIC bundle_size_bytes=45000
ASI hypothesis=reduced_loop_iterations
ASI next_action_hint=try_unrolling_factor_4
```

- `METRIC <name>=<value>` — one per line, numeric values only
- `ASI <key>=<value>` — optional, any string value (hypothesis, next_action_hint, rollback_reason, etc.)
- Exit code 0 = success, non-zero = failure

## Git Workflow

1. `init_experiment` creates branch: `autoresearch/<goal>-<YYYYMMDD>`
2. `run_experiment` runs benchmark, records modified files
3. `log_experiment keep` commits changes with formatted message
4. `log_experiment discard` resets worktree to HEAD
5. At any point: `git log` shows the experiment history

## Auto-Compaction

After every `log_experiment`, the plugin automatically triggers a session compaction via `client.summarize()`. This:

- Summarizes the conversation history
- Preserves experiment context (goal, baseline, best result)
- Injects a synthetic "continue" message
- Keeps the agent loop running indefinitely

## Storage

- **SQLite**: `~/.opencode-autoresearch/<encoded-project-path>.db`
  - `sessions` table: experiment configuration
  - `runs` table: benchmark results
- **Logs**: `~/.opencode-autoresearch/<project>/runs/<id>/benchmark.log`
- **Markdown**: `./autoresearch.md` in project root

## Configuration

No configuration required. The plugin auto-detects:
- Current git branch
- Project directory
- Available models (for compaction)

## Features

- ✅ Automated experiment loop
- ✅ Git branch isolation (`autoresearch/*`)
- ✅ Auto-commit on keep / auto-reset on discard
- ✅ Scope deviation detection
- ✅ Confidence scoring (MAD-based)
- ✅ Max iteration enforcement
- ✅ Auto-compaction after every iteration
- ✅ Secondary metric tracking
- ✅ ASI (Agent State Info) logging
- ✅ Persistent experiment notes
- ✅ `autoresearch.md` auto-generation and updates

## Limitations (vs oh-my-pi)

- ❌ No TUI dashboard widget (opencode server plugins cannot render UI)
- ❌ No synthetic auto-resume messages (mitigated by strong system prompt + compaction auto-continue)
- ❌ No custom tool renderers (standard opencode tool output)

## License

MIT
