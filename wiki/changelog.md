# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] - 2026-05-25

### Added
- Complete WIKI documentation with 9 comprehensive pages
- Wiki completeness benchmark in `autoresearch.sh`

### Improved
- Documentation coverage for all source files
- JSDoc comments covering 51 exported functions
- Type documentation for 22 interfaces/types
- Comment ratio improved from 11% to 25%

## [0.1.0] - 2026-05-20

### Added
- Initial plugin implementation
- 4 tools: `init_experiment`, `run_experiment`, `log_experiment`, `update_notes`
- `/autoresearch` command for OpenCode integration
- Git branch isolation with `autoresearch/*` prefix
- SQLite persistence layer
- Auto-compaction after experiment logging
- Scope deviation detection
- Confidence scoring using MAD (Median Absolute Deviation)
- Secondary metric tracking
- ASI (Agent State Info) logging
- System prompt injection with experiment state

### Features
- Automatic `autoresearch.md` generation and updates
- Auto-commit on `keep`, auto-reset on `discard`/`crash`
- Max iteration enforcement
- Template-based prompts (`src/prompts/system.md`, `src/prompts/setup.md`)
- Git worktree dirty path tracking
- Cross-platform path normalization
- Comprehensive test suite (unit + E2E)

### Technical
- TypeScript with strict mode
- ESM module system
- Bun runtime (`bun:sqlite`, `bun:test`)
- Zod schema validation (pinned to 4.1.8)
- SQLite WAL mode for concurrent access

## [0.0.1] - 2026-05-15

### Added
- Project scaffolding
- Basic plugin structure
- Initial README
- Package configuration for npm publishing

---

## Future Roadmap

### Planned
- [ ] Web dashboard for experiment visualization
- [ ] Support for multiple concurrent experiments
- [ ] Integration with CI/CD pipelines
- [ ] Custom benchmark harness templates
- [ ] Experiment result comparison tools
- [ ] Export to CSV/JSON for analysis

### Under Consideration
- [ ] Machine learning-based optimization suggestions
- [ ] Distributed benchmarking support
- [ ] Real-time collaboration on experiments
- [ ] Plugin marketplace integration

## Versioning

This project follows [Semantic Versioning](https://semver.org/):
- `MAJOR`: Breaking changes to tool APIs or plugin contract
- `MINOR`: New features, backward compatible
- `PATCH`: Bug fixes and documentation updates
