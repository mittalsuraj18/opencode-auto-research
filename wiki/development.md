# Development Guide

## Development Setup

### Prerequisites
- [Bun](https://bun.sh) runtime (not Node.js/npm)
- Git repository
- OpenCode project

### Installation
```bash
# Clone the repository
git clone https://github.com/mittalsuraj18/opencode-auto-research.git
cd opencode-auto-research

# Install dependencies
bun install

# Run tests
bun test --timeout 30000

# Build
bun run build
```

## Project Structure

```
src/
├── index.ts              # Plugin entry point
├── types.ts              # Central type definitions
├── state.ts              # Runtime state helpers
├── storage.ts            # SQLite persistence layer
├── git.ts                # Git branch detection & operations
├── helpers.ts            # Parsing, formatting, path utilities
└── tools/
    ├── init-experiment.ts  # init_experiment tool
    ├── run-experiment.ts   # run_experiment tool
    ├── log-experiment.ts   # log_experiment tool
    └── update-notes.ts     # update_notes tool

test/
├── unit/                  # Unit tests for individual modules
└── e2e/                   # End-to-end plugin tests
```

## Adding a New Tool

1. Create tool file in `src/tools/`:
```typescript
// src/tools/my-tool.ts
import type { AutoresearchRuntime } from "../types";

export function createMyTool({ storage, runtime, directory }: {
  storage: AutoresearchStorage;
  runtime: AutoresearchRuntime;
  directory: string;
}) {
  return async (params: { someParam: string }) => {
    // Tool implementation
    return { result: "success" };
  };
}
```

2. Register in `src/index.ts`:
```typescript
import { createMyTool } from "./tools/my-tool";

const myTool = createMyTool({ storage, runtime, directory });

return {
  tool: {
    // ... other tools
    my_tool: myTool,
  },
  // ...
};
```

## Adding Tests

### Unit Test Pattern
```typescript
import { describe, it, expect } from "bun:test";
import { someFunction } from "../src/module";

describe("Module", () => {
  it("should do something", () => {
    expect(someFunction()).toBe(true);
  });
});
```

### E2E Test Pattern
```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Plugin E2E", () => {
  let tempDir: string;
  
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "autoresearch-test-"));
    // Setup git repo, create autoresearch.sh, etc.
  });
  
  afterEach(() => {
    // Cleanup
  });
  
  it("should run full experiment lifecycle", async () => {
    // Test the plugin
  });
});
```

## Key Implementation Details

### Prompt Loading
Prompts are loaded at runtime using `__dirname` resolution:
```typescript
const systemPromptPath = path.join(__dirname, "..", "src", "prompts", "system.md");
```

**Important**: `src/prompts/` is included in the published package alongside `dist/` because of this runtime resolution.

### SQLite Database
- Uses Bun's built-in `bun:sqlite` module
- WAL mode enabled for concurrent access
- Located at `~/.opencode-autoresearch/<encoded-project-path>.db`

### Git Operations
- Uses Bun's `$` template literal for shell execution
- All paths are normalized for cross-platform compatibility
- Dirty path tracking prevents data loss

### Scope Deviation Detection
Before `log_experiment`, the plugin compares pre-run and post-run git status:
```typescript
const { tracked, untracked } = computeRunModifiedPaths(
  preRunDirtyPaths,
  currentStatus,
  workDirPrefix
);
```

Files outside `scope_paths` or inside `off_limits` are flagged.

## Build & Publish

```bash
# Build TypeScript to dist/
bun run build

# Run all tests
bun test --timeout 30000

# Full publish prep (build + test)
bun run prepublishOnly
```

### Publishing Checklist
- Version updated in `package.json`
- `src/prompts/` included in `files` array
- Tests passing
- Build successful

## Debugging

### Enable Verbose Logging
Add console.log statements in tool implementations or use OpenCode's built-in debugging.

### Inspect SQLite Database
```bash
# Find your database
ls ~/.opencode-autoresearch/

# Query with sqlite3
sqlite3 ~/.opencode-autoresearch/your-project.db "SELECT * FROM sessions;"
sqlite3 ~/.opencode-autoresearch/your-project.db "SELECT * FROM runs ORDER BY id DESC LIMIT 5;"
```

### Check Benchmark Logs
```bash
# Find run logs
ls ~/.opencode-autoresearch/<project>/runs/

# View specific log
cat ~/.opencode-autoresearch/<project>/runs/<id>/benchmark.log
```

## Common Development Patterns

### Testing Scope Deviations
```typescript
// In a test, simulate modifying a file outside scope
await Bun.write(join(tempDir, "README.md"), "modified");

// Then log should detect the deviation
const logResult = await logExperiment({
  metric: 100,
  status: "keep",
  description: "test"
});

// Check that scopeDeviations contains "README.md"
```

### Simulating Git States
```typescript
// Create files to simulate dirty state
await Bun.write(join(tempDir, "src/test.ts"), "export const x = 1;");
await $`git -C ${tempDir} add .`.quiet();
```
