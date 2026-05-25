# Troubleshooting

## Common Issues

### "Worktree is dirty" Error

**Problem**: `init_experiment` fails with "Worktree is dirty".

**Solution**:
```bash
# Check what's dirty
git status

# Commit or stash changes
git add .
git commit -m "WIP: save before autoresearch"
# or
git stash
```

The plugin requires a clean worktree before creating a new autoresearch branch.

### Benchmark Script Not Found

**Problem**: `run_experiment` fails because `autoresearch.sh` doesn't exist.

**Solution**:
```bash
# Create the benchmark script
cat > autoresearch.sh << 'EOF'
#!/bin/bash
METRIC my_metric=100
EOF
chmod +x autoresearch.sh
```

### Metric Not Parsed

**Problem**: `run_experiment` succeeds but metric shows as null.

**Common Causes**:
1. **Format mismatch**: Use `METRIC name=value` (not `METRIC: name=value`)
2. **Non-numeric value**: Metric values must be numbers only
3. **Wrong metric name**: Must match `primary_metric` from `init_experiment`

**Correct Format**:
```bash
#!/bin/bash
METRIC compile_time_ms=1200.50
METRIC bundle_size_bytes=45000
```

### SQLite Database Locked

**Problem**: Database operations fail with "database is locked".

**Solution**:
- The plugin already sets `PRAGMA busy_timeout=5000`
- If the issue persists, check for other processes accessing the database:
```bash
lsof ~/.opencode-autoresearch/*.db
```

### Git Reset Issues

**Problem**: `log_experiment discard` doesn't fully revert changes.

**Solution**:
- Check if you're on an autoresearch branch:
```bash
git branch --show-current
```
- On autoresearch branches: full `git reset --hard HEAD` + `git clean -fd`
- On other branches: only run-modified files are reverted
- Manually clean if needed:
```bash
git reset --hard HEAD
git clean -fd
```

### Compaction Not Triggering

**Problem**: Session doesn't compact after `log_experiment`.

**Causes**:
1. No model available (`runtime.currentModel` is null)
2. Event handler not receiving `session.next.step.ended`
3. `client.summarize()` threw an error (check console)

**Workaround**: Manually compact the session in OpenCode.

### Scope Deviation False Positives

**Problem**: `log_experiment` flags files as deviations that weren't modified by the experiment.

**Cause**: The pre-run dirty path snapshot captured pre-existing changes.

**Solution**: Ensure the worktree is clean before `run_experiment`.

### Bun.spawn Timeout in Tests

**Problem**: Tests timeout when using `run_experiment`.

**Cause**: The test context may have different timing characteristics.

**Solution**: 
- Use `--timeout 30000` flag: `bun test --timeout 30000`
- Increase timeout in `run_experiment` call: `run_experiment({ timeout_seconds: 120 })`

## Debugging Steps

### 1. Check Experiment State
```bash
# View autoresearch.md
cat autoresearch.md
```

### 2. Inspect Database
```bash
# List sessions
sqlite3 ~/.opencode-autoresearch/*.db "SELECT id, name, goal, branch, closed_at FROM sessions;"

# List recent runs
sqlite3 ~/.opencode-autoresearch/*.db "SELECT id, status, metric, description FROM runs ORDER BY id DESC LIMIT 5;"
```

### 3. Check Benchmark Logs
```bash
# Find the log directory
ls ~/.opencode-autoresearch/<project>/runs/

# View a specific run's log
cat ~/.opencode-autoresearch/<project>/runs/<id>/benchmark.log
```

### 4. Verify Git State
```bash
# Check current branch
git branch --show-current

# Check for uncommitted changes
git status --short

# Check recent commits
git log --oneline -5
```

## Error Messages Reference

| Error | Meaning | Solution |
|-------|---------|----------|
| "Not in a git repository" | Project isn't a git repo | Run `git init` |
| "Worktree is dirty" | Uncommitted changes exist | Commit or stash |
| "Failed to create autoresearch branch" | Git error creating branch | Check git permissions |
| "Unable to inspect git status" | Git command failed | Check git installation |
| "METRIC not found in output" | Benchmark didn't emit the metric | Check `autoresearch.sh` format |
| "Database is locked" | Concurrent access to SQLite | Wait and retry |
| "No active session" | Plugin not initialized | Call `init_experiment` first |
| "Max iterations reached" | Hit the run limit | Start new segment with `new_segment: true` |

## Getting Help

1. Check the [Examples](examples.md) page for common patterns
2. Review the [Architecture](architecture.md) page for implementation details
3. Inspect the benchmark logs for execution details
4. Check the SQLite database for experiment history

## Reporting Bugs

When reporting issues, include:
- `autoresearch.md` content
- Relevant benchmark logs
- Git state (`git status`, `git log --oneline -5`)
- SQLite session/run data
- OpenCode version and plugin version
