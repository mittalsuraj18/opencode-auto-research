# @mittalsuraj18/opencode-auto-research

[![npm version](https://img.shields.io/npm/v/@mittalsuraj18/opencode-auto-research.svg)](https://www.npmjs.com/package/@mittalsuraj18/opencode-auto-research)
[![npm downloads](https://img.shields.io/npm/dm/@mittalsuraj18/opencode-auto-research.svg)](https://www.npmjs.com/package/@mittalsuraj18/opencode-auto-research)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub issues](https://img.shields.io/github/issues/mittalsuraj18/opencode-auto-research.svg)](https://github.com/mittalsuraj18/opencode-auto-research/issues)

An [OpenCode](https://opencode.ai) plugin that implements an **automated benchmark-driven optimization loop** — a lightweight, OpenCode-native take on the [autoresearch](https://github.com/karpathy/autoresearch) pattern popularized by Andrej Karpathy.

## What is Autoresearch?

The autoresearch pattern — introduced by [karpathy/autoresearch](https://github.com/karpathy/autoresearch) (83K+ stars) — is a simple but powerful idea: give an AI agent a measurable goal and let it experiment autonomously. The agent modifies code, runs a benchmark, checks if the result improved, keeps or discards the change, and repeats. You wake up in the morning to a log of experiments and (hopefully) a better codebase.

This plugin brings that pattern directly into OpenCode as a first-class plugin — no external scripts, no manual orchestration. The loop runs inside your existing OpenCode session with built-in git isolation, auto-compaction, and scope enforcement.

### How it differs from other tools

| Tool | Approach | Key Difference |
|------|----------|----------------|
| **This plugin** | OpenCode-native plugin | Runs inside OpenCode session; auto-compaction; git branch isolation; scope enforcement |
| [karpathy/autoresearch](https://github.com/karpathy/autoresearch) | Standalone script + program.md | Single-file optimization (ML training); agent reads markdown instructions |
| [ratchet](https://github.com/alephmelo/ratchet) | CLI orchestrator | Generates agent prompts; handles git/benchmark externally; multi-armed bandit strategy selection |
| [auto-optimize](https://github.com/bluuewhale/auto-optimize) | Claude Code skill | Structured reasoning pipeline (Opus planner); noise-floor validation; disassembly analysis |
| [darwin-derby](https://github.com/kousun12/darwin-derby) | CLI orchestrator | Swarm mode; git-push-based proposals; evaluation hidden from agents |
| [Artificial General Research](https://github.com/JoaquinMulet/Artificial-General-Research) | Claude Code skill | Fresh context per iteration; Metric+Guard+Rework pattern; stuck detection protocol |
| [VeRO](https://github.com/scaleapi/vero) | Python evaluation harness | Optimizes LLM-based agent code; subprocess-isolated evaluations |
| [Maleick/AutoResearch](https://github.com/Maleick/AutoResearch) | OpenCode + Hermes plugin | Subagent-first; multi-runtime (OpenCode + Hermes); recursive self-improvement; 15+ slash commands |

## Overview

This plugin enables OpenCode agents to systematically optimize code performance through:

1. **Benchmark harness** (`autoresearch.sh`) — measures target metrics
2. **Experiment loop** — modify code, run benchmark, evaluate, keep or discard
3. **Auto-compaction** — context is compacted after every iteration to prevent overflow
4. **Git integration** — commits on keep, resets on discard, dedicated branches
5. **Scope enforcement** — restrict which files the agent can and cannot modify
6. **Confidence scoring** — MAD-based statistical confidence in improvements

## Installation

### From npm (recommended)

```bash
npm install @mittalsuraj18/opencode-auto-research
```

Add to your `opencode.json`:

```json
{
  "plugin": ["@mittalsuraj18/opencode-auto-research"]
}
```

Restart OpenCode. The `/autoresearch` command and all four tools are now available.

### From local files

Place the built plugin in `.opencode/plugins/` or `~/.config/opencode/plugins/`. See [OpenCode plugin docs](https://opencode.ai/docs/plugins) for details.

## Quick Start

### Option 1: The `/autoresearch` command (easiest)

Just type in OpenCode:

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

### Option 2: Direct tool usage

1. Create `autoresearch.sh` in your project root that prints metrics:
   ```bash
   #!/bin/bash
   # Run your benchmark here...
   METRIC compile_time_ms=1200
   METRIC bundle_size_bytes=45000
   ASI hypothesis=reduced_loop_iterations
   ASI next_action_hint=try_unrolling_factor_4
   ```

2. Call `init_experiment` with your benchmark name and metric
3. Call `run_experiment` to run the baseline
4. Call `log_experiment` with `status: keep` to establish the baseline
5. The agent will auto-iterate, optimizing the metric

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

## How the Loop Works

```
┌─────────────────────────────────────────────────────────┐
│  AUTORESEARCH LOOP                                      │
│                                                          │
│  1. init_experiment → create branch, set goal & metric    │
│  2. run_experiment → execute autoresearch.sh              │
│  3. Agent analyzes results                               │
│  4. log_experiment (keep/discard/crash)                   │
│     ├─ keep    → commit changes, update best             │
│     ├─ discard → git reset --hard HEAD + clean           │
│     └─ crash   → git reset --hard HEAD + clean           │
│  5. Auto-compact session context                         │
│  6. Continue from step 2                                 │
└─────────────────────────────────────────────────────────┘
```

Each iteration is fully automated. The agent modifies code within the configured scope, runs the benchmark, evaluates the result, and decides whether to keep or discard. After logging, the session is compacted to prevent context overflow, and the loop continues indefinitely until max iterations are reached or the user interrupts.

## Git Workflow

1. `init_experiment` creates branch: `autoresearch/<goal>-<YYYYMMDD>`
2. `run_experiment` runs benchmark, records modified files
3. `log_experiment keep` commits changes with formatted message
4. `log_experiment discard` resets worktree to HEAD
5. At any point: `git log` shows the experiment history

This mirrors the git workflow from [karpathy/autoresearch](https://github.com/karpathy/autoresearch)'s `program.md`, but is handled automatically by the plugin rather than requiring the agent to manually manage git commands.

## Auto-Compaction

After every `log_experiment`, the plugin automatically triggers a session compaction via `client.summarize()`. This:

- Summarizes the conversation history
- Preserves experiment context (goal, baseline, best result)
- Injects a synthetic "continue" message via `experimental.compaction.autocontinue`
- Keeps the agent loop running indefinitely without context overflow

Without auto-compaction, each iteration adds context until the model's context window fills up and the loop degrades. This plugin solves that by compacting after every iteration while preserving the essential experiment state through `experimental.session.compacting` hooks.

## Scope Enforcement

The plugin tracks which files the agent modifies during each experiment:

- **`scope_paths`** — restrict modifications to only these paths
- **`off_limits`** — explicitly forbid modifications to these paths
- **Deviation detection** — `log_experiment` flags any modifications outside the declared scope

This prevents the agent from accidentally modifying critical files (e.g., test fixtures, config files, lock files) during its optimization loop.

## Confidence Scoring

The plugin uses a **Median Absolute Deviation (MAD)**-based confidence score to evaluate whether an improvement is statistically meaningful:

- Low confidence → the improvement may be within measurement noise
- High confidence → the improvement is likely real

This helps the agent make informed decisions about whether to keep aggressive changes or revert to the baseline.

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

## Source Layout

| File / Dir | Role |
|------------|------|
| `src/index.ts` | Plugin entry point. Registers 4 tools, the `/autoresearch` command, system-prompt injection, and compaction hooks. |
| `src/types.ts` | Central type definitions (`ExperimentState`, `AutoresearchRuntime`, etc.). |
| `src/state.ts` | Runtime state helpers (`createRuntimeStore`, `buildExperimentState`). |
| `src/storage.ts` | SQLite persistence layer. |
| `src/git.ts` | Git branch detection, commit/reset helpers. |
| `src/helpers.ts` | Shared formatting and parsing utilities. |
| `src/tools/init-experiment.ts` | `init_experiment` tool — creates branch, session, baseline. |
| `src/tools/run-experiment.ts` | `run_experiment` tool — executes `autoresearch.sh`, parses `METRIC`/`ASI` lines. |
| `src/tools/log-experiment.ts` | `log_experiment` tool — commits on `keep`, resets on `discard`/`crash`, updates `autoresearch.md`. |
| `src/tools/update-notes.ts` | `update_notes` tool — appends to experiment notes. |
| `src/prompts/system.md` | Template for injected system prompt when autoresearch mode is active. |
| `src/prompts/setup.md` | Template used during experiment setup. |

## Features

- Automated experiment loop with keep/discard decisions
- Git branch isolation (`autoresearch/*`) — experiment safely without touching main
- Auto-commit on keep / auto-reset on discard — clean state after every iteration
- Scope deviation detection — restrict what the agent can modify
- Confidence scoring (MAD-based) — distinguish real improvements from noise
- Max iteration enforcement — prevents runaway loops
- Auto-compaction after every iteration — unlimited iterations without context overflow
- Secondary metric tracking — monitor additional metrics alongside the primary one
- ASI (Agent State Info) logging — pass hypotheses and hints between iterations
- Persistent experiment notes — `update_notes` persists across compactions
- `autoresearch.md` auto-generation and updates — experiment log in your repo
- `/autoresearch` slash command — start or resume experiments with one command
- OpenCode-native — no external scripts, runs inside your existing session

## Comparison with the Original Autoresearch Pattern

[Karpathy's autoresearch](https://github.com/karpathy/autoresearch) introduced a simple loop: modify code → run benchmark → keep or revert → repeat. The agent reads a `program.md` file with instructions and manages git manually. This plugin builds on that foundation with several OpenCode-native improvements:

| Aspect | karpathy/autoresearch | This Plugin |
|--------|----------------------|-------------|
| Runtime | Standalone (any agent) | OpenCode plugin |
| Git management | Manual by agent | Automatic (plugin handles commit/reset) |
| Context management | Agent-dependent (often degrades) | Auto-compaction with state preservation |
| Metric parsing | Agent reads raw output | Structured `METRIC`/`ASI` protocol |
| Scope control | Single-file convention | Explicit `scope_paths` / `off_limits` |
| Confidence | None (manual threshold) | MAD-based statistical confidence |
| Session persistence | Git log only | SQLite + git + markdown |
| Branch isolation | Manual by agent | Automatic (`autoresearch/*` branch) |
| Command interface | Prompt-based | `/autoresearch` slash command + 4 tools |

## Limitations

- No TUI dashboard widget (OpenCode server plugins cannot render UI)
- No synthetic auto-resume messages (mitigated by strong system prompt + compaction auto-continue)
- No custom tool renderers (standard OpenCode tool output)
- No multi-agent swarm mode (see [darwin-derby](https://github.com/kousun12/darwin-derby) for swarm experiments)
- No multi-armed bandit strategy selection (see [ratchet](https://github.com/alephmelo/ratchet) for bandit-based approaches)
- No built-in noise-floor validation (see [auto-optimize](https://github.com/bluuewhale/auto-optimize) for variance checks)

## License

MIT
