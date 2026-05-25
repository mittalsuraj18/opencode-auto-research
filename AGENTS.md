# AGENTS.md — opencode-auto-research

OpenCode plugin that implements an automated benchmark-driven optimization loop for OpenCode agents.

## Runtime & Toolchain

- **Package manager / runtime:** Bun. Use `bun install`, `bun test`, `bun run build`. Do not use `npm` or `node`.
- **Test runner:** `bun:test`. Run with `bun test --timeout 30000`.
- **Build:** `tsc` only. Output goes to `dist/`. `src/prompts/` is copied/retained at publish time (it is referenced at runtime via `__dirname` → `../src/prompts/`).
- **Module system:** ESM only (`"type": "module"`). Use `import` syntax everywhere.
- **TypeScript:** Strict mode, `moduleResolution: bundler`.
- **No lint or formatter config** is present. Do not assume Prettier or ESLint rules.

## Source Layout

| File / Dir | Role |
|------------|------|
| `src/index.ts` | Plugin entry point. Exports the default plugin function. Registers 4 tools, the `/autoresearch` command, system-prompt injection, and compaction hooks. |
| `src/types.ts` | Central type definitions (`ExperimentState`, `AutoresearchRuntime`, etc.). |
| `src/state.ts` | Runtime state helpers (`createRuntimeStore`, `buildExperimentState`). |
| `src/storage.ts` | SQLite persistence layer. DB lives in `~/.opencode-autoresearch/<encoded-project-path>.db`. |
| `src/git.ts` | Git branch detection, commit/reset helpers. |
| `src/helpers.ts` | Shared formatting and parsing utilities. |
| `src/tools/init-experiment.ts` | `init_experiment` tool — creates branch, session, baseline. |
| `src/tools/run-experiment.ts` | `run_experiment` tool — executes `autoresearch.sh`, parses `METRIC`/`ASI` lines. |
| `src/tools/log-experiment.ts` | `log_experiment` tool — commits on `keep`, resets on `discard`/`crash`, updates `autoresearch.md`. |
| `src/tools/update-notes.ts` | `update_notes` tool — appends to experiment notes. |
| `src/prompts/system.md` | Template for injected system prompt when autoresearch mode is active. |
| `src/prompts/setup.md` | Template used during experiment setup. |

## Key Developer Commands

```bash
# Install dependencies
bun install

# Run all tests (unit + e2e)
bun test --timeout 30000

# Build to dist/
bun run build

# Full publish prep (build + test)
bun run prepublishOnly
```

## Plugin Architecture Notes

- **Entry contract:** The default export is an async function satisfying `Plugin` from `@opencode-ai/plugin`. It receives `{ client, directory }` and returns an object with `tool`, `config`, `command.execute.before`, `chat`, `experimental.chat.system.transform`, `experimental.session.compacting`, `experimental.compaction.autocontinue`, and `event` keys.
- **Prompt loading:** At runtime the plugin reads `src/prompts/system.md` and `src/prompts/setup.md` using `path.join(__dirname, "..", "src", "prompts", "...")`. Because of this, `src/prompts` is listed in `package.json` `files` alongside `dist`; changing the directory structure or build output layout will break prompt resolution.
- **Auto-compaction:** After every `log_experiment`, the plugin sets `runtime.justLoggedExperiment = true`. The `event` handler listens for `session.next.step.ended` and triggers `client.summarize()` to compact the session and keep the loop running.
- **Git workflow:** `init_experiment` creates branches named `autoresearch/<goal>-<YYYYMMDD>`. `log_experiment keep` commits the changes; `discard`/`crash` runs `git reset --hard HEAD` + `git clean -fd` on autoresearch branches.
- **Scope enforcement:** The plugin records pre-run dirty paths and post-run modified paths. `log_experiment` detects scope deviations (files outside `scope_paths` or inside `off_limits`) and flags them.

## Testing

- **Unit tests:** `test/unit/` cover `git`, `helpers`, `state`, and `storage` in isolation.
- **E2E tests:** `test/e2e/plugin.e2e.test.ts` exercises the full plugin lifecycle using temporary directories and mock clients. It does not require a real OpenCode server.
- Tests use `bun:test` (`describe`, `it`, `expect`, `beforeEach`, `afterEach`).

## Publishing

- `package.json` `prepublishOnly` runs build then test. Do not skip tests before publishing.
- Published artifacts: `dist/` + `src/prompts/`.
- Published entry: `./dist/index.js`.

## Low-level Constraints

- `zod` is pinned to `4.1.8` (not a range).
- The plugin stores logs and SQLite data under `~/.opencode-autoresearch/<project>/`.
- Benchmark harness (`autoresearch.sh`) must emit lines like `METRIC name=value` and `ASI key=value`. Exit code 0 = success.
