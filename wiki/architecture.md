# Architecture

## Plugin Architecture

### Entry Point (`src/index.ts`)
The plugin is exported as a default async function satisfying the OpenCode `Plugin` interface. It receives `{ client, directory }` and returns a configuration object with multiple hooks.

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Plugin Entry (index.ts)                   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐│
│  │   Storage   │  │    State      │  │      Git            ││
│  │  (SQLite)   │  │  Management  │  │   Operations        ││
│  └─────────────┘  └──────────────┘  └─────────────────────┘│
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐│
│  │  Helpers    │  │   Tools      │  │   Prompts          ││
│  │ (Parsing)   │  │(4 registered)│  │(system + setup)   ││
│  └─────────────┘  └──────────────┘  └─────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Initialization**
   - Plugin loads and rehydrates active sessions from SQLite
   - Reads prompt templates from `src/prompts/`
   - Registers 4 tools and the `/autoresearch` command

2. **Experiment Lifecycle**
   ```
   init_experiment → run_experiment → log_experiment → [repeat]
   ```

3. **State Persistence**
   - Sessions stored in SQLite (`~/.opencode-autoresearch/`)
   - Each run records: metrics, status, commit hash, modified files
   - `autoresearch.md` updated with experiment history

### System Prompt Injection
When autoresearch mode is active, the plugin injects a system prompt that:
- Shows current experiment state (goal, baseline, best result)
- Lists recent run results
- Warns about pending runs that need logging
- Instructs the agent to continue iterating autonomously

### Compaction Strategy
The plugin hooks into OpenCode's compaction system:
- **`experimental.chat.system.transform`**: Injects experiment context
- **`experimental.session.compacting`**: Provides compaction summary
- **`experimental.compaction.autocontinue`**: Enables auto-continue
- **`event`**: Triggers compaction after `log_experiment`

### Git Integration

#### Branch Management
- Branches named: `autoresearch/<goal-slug>-<YYYYMMDD>`
- Creates fresh branch if not on an autoresearch branch
- Validates worktree is clean before switching

#### Commit/Reset Workflow
- **`log_experiment keep`**: Commits changes with formatted message
- **`log_experiment discard`**: `git reset --hard HEAD` + `git clean -fd`
- Scope deviations detected and reported

### SQLite Schema

#### Sessions Table
```sql
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    goal TEXT,
    primary_metric TEXT NOT NULL,
    metric_unit TEXT NOT NULL DEFAULT '',
    direction TEXT NOT NULL DEFAULT 'lower',
    branch TEXT,
    baseline_commit TEXT,
    current_segment INTEGER NOT NULL DEFAULT 0,
    max_iterations INTEGER,
    scope_paths_json TEXT NOT NULL DEFAULT '[]',
    off_limits_json TEXT NOT NULL DEFAULT '[]',
    constraints_json TEXT NOT NULL DEFAULT '[]',
    secondary_metrics_json TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    closed_at INTEGER
);
```

#### Runs Table
```sql
CREATE TABLE runs (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    segment INTEGER NOT NULL,
    command TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    duration_ms INTEGER,
    exit_code INTEGER,
    timed_out INTEGER NOT NULL DEFAULT 0,
    parsed_primary REAL,
    parsed_metrics_json TEXT,
    parsed_asi_json TEXT,
    pre_run_dirty_paths_json TEXT NOT NULL DEFAULT '[]',
    log_path TEXT NOT NULL,
    status TEXT,
    description TEXT,
    metric REAL,
    metrics_json TEXT,
    asi_json TEXT,
    commit_hash TEXT,
    confidence REAL,
    modified_paths_json TEXT,
    scope_deviations_json TEXT,
    justification TEXT,
    flagged INTEGER NOT NULL DEFAULT 0,
    flagged_reason TEXT,
    logged_at INTEGER,
    abandoned_at INTEGER
);
```

### Confidence Scoring
Uses Median Absolute Deviation (MAD) to compute statistical confidence:
```
confidence = |best_kept - baseline| / MAD
```
- Requires at least 3 non-flagged runs with positive metrics
- Higher confidence = more reliable improvement

### Type System
The plugin uses a comprehensive type system defined in `src/types.ts`:
- `ExperimentState`: Complete experiment state
- `ExperimentResult`: Individual run result
- `AutoresearchRuntime`: In-memory runtime state
- `SessionRow`: Database session representation
- `ASIData`: Agent State Info key-value structure

## Module Dependencies

```
index.ts
├── types.ts
├── state.ts (→ types, helpers)
├── storage.ts (→ types)
├── git.ts (→ helpers)
├── helpers.ts (→ types)
├── tools/
│   ├── init-experiment.ts (→ types, state, storage, git, helpers)
│   ├── run-experiment.ts (→ types, state, storage, helpers)
│   ├── log-experiment.ts (→ types, state, storage, git, helpers)
│   └── update-notes.ts (→ types, storage)
```

## Security Considerations
- Path validation prevents `__proto__`, `constructor`, `prototype` poisoning
- Scope deviations are detected and flagged
- Git operations are sandboxed to the project directory
- SQLite uses WAL mode for safe concurrent access
