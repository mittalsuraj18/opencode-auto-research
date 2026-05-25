# Overview

## What is opencode-auto-research?

**opencode-auto-research** is an autoresearch plugin for [OpenCode](https://opencode.ai) that implements an automated benchmark-driven optimization loop. It enables OpenCode agents to systematically optimize code performance through controlled experimentation.

## Key Concepts

### Experiment Loop
The plugin implements a systematic experiment loop:
1. **Initialize** an experiment with a goal and metric
2. **Run** benchmarks to measure current performance
3. **Log** results with keep/discard decisions
4. **Iterate** until the goal is achieved

### Metrics-Driven Optimization
Every experiment tracks:
- **Primary metric**: The main target (e.g., compile time, bundle size, test coverage)
- **Secondary metrics**: Additional measurements captured automatically
- **ASI (Agent State Info)**: Metadata like hypotheses and next actions

### Auto-Compaction
After every logged experiment, the plugin triggers session compaction to prevent context overflow, allowing the agent to iterate indefinitely.

## Features

- ✅ Automated experiment loop
- ✅ Git branch isolation (`autoresearch/*`)
- ✅ Auto-commit on keep / auto-reset on discard
- ✅ Scope deviation detection (prevents modifying files outside allowed paths)
- ✅ Confidence scoring using Median Absolute Deviation (MAD)
- ✅ Max iteration enforcement
- ✅ Auto-compaction after every iteration
- ✅ Secondary metric tracking
- ✅ ASI (Agent State Info) logging
- ✅ Persistent experiment notes
- ✅ `autoresearch.md` auto-generation and updates

## Project Structure

```
opencode-auto-research/
├── src/
│   ├── index.ts              # Plugin entry point
│   ├── types.ts              # Type definitions
│   ├── state.ts              # State management & statistics
│   ├── storage.ts            # SQLite persistence
│   ├── git.ts                # Git operations
│   ├── helpers.ts            # Utilities & parsers
│   └── tools/
│       ├── init-experiment.ts
│       ├── run-experiment.ts
│       ├── log-experiment.ts
│       └── update-notes.ts
├── test/                     # Unit & E2E tests
├── src/prompts/
│   ├── system.md             # System prompt template
│   └── setup.md              # Setup prompt template
├── autoresearch.sh           # Benchmark harness
└── autoresearch.md           # Experiment log
```

## Philosophy

This plugin follows the principle of **controlled experimentation**:
- Changes are isolated in git branches
- Every modification is benchmarked before keeping
- Failed experiments are automatically reverted
- Progress is tracked with statistical confidence

## Getting Started

See the [Examples](examples.md) page for common usage patterns, or read the [Architecture](architecture.md) page to understand the plugin internals.
