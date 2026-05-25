# Contributing

## Development Workflow

### 1. Fork and Clone
```bash
git clone https://github.com/mittalsuraj18/opencode-auto-research.git
cd opencode-auto-research
```

### 2. Install Dependencies
```bash
bun install
```

### 3. Create a Branch
```bash
git checkout -b feature/my-feature
```

### 4. Make Changes
- Follow the existing code style
- Add JSDoc comments to exported functions
- Update tests for new functionality

### 5. Test
```bash
# Run all tests
bun test --timeout 30000

# Run specific test file
bun test test/unit/helpers.test.ts

# Build
bun run build
```

### 6. Commit
```bash
git add .
git commit -m "feat: description of changes"
```

## Code Standards

### TypeScript
- Use ESM imports (`import` syntax)
- Enable strict mode (already configured in `tsconfig.json`)
- Use `type` imports where possible: `import type { Foo } from "./bar"`

### Naming
- Functions: `camelCase`
- Types/Interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Files: `kebab-case.ts`

### Documentation
- All exported functions must have JSDoc comments
- Include `@param` and `@returns` tags
- Add `@description` in file headers

Example:
```typescript
/**
 * Computes the median of an array of numbers.
 * @param values - Array of numeric values
 * @returns Median value, or 0 for empty arrays
 */
export function sortedMedian(values: number[]): number {
  // Implementation
}
```

### Testing
- Unit tests for all utility functions
- E2E tests for tool workflows
- Use `bun:test` (`describe`, `it`, `expect`)
- Mock external dependencies (git, SQLite)

### Error Handling
- Use `try/catch` for async operations
- Return null/undefined for recoverable errors
- Log non-fatal errors to console
- Preserve error messages for user feedback

## Pull Request Process

1. **Update documentation**: If adding features, update relevant WIKI pages
2. **Add tests**: All new functionality must have tests
3. **Ensure build passes**: `bun run build` must succeed
4. **Ensure tests pass**: `bun test --timeout 30000` must pass
5. **Describe changes**: Write clear PR description with:
   - What changed and why
   - How to test the changes
   - Any breaking changes

## Commit Message Format

Use conventional commits:
```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Test changes
- `refactor`: Code refactoring
- `perf`: Performance improvement
- `chore`: Build/tooling changes

Examples:
```
feat(tools): add max_runtime parameter to run_experiment
fix(git): handle repositories with spaces in paths
docs(wiki): add architecture diagram
test(storage): add benchmark for large sessions
```

## Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Run `bun run prepublishOnly`
4. Create git tag: `git tag v0.1.2`
5. Push tag: `git push origin v0.1.2`

## Areas for Contribution

### High Priority
- Additional benchmark harness examples
- Improved documentation coverage
- Performance optimizations for SQLite operations

### Nice to Have
- Additional tool implementations
- Better error messages and diagnostics
- Support for custom prompt templates
- Integration tests for different project types

## Code of Conduct

- Be respectful and constructive
- Focus on the problem, not the person
- Welcome newcomers and help them learn
- Acknowledge contributions

## Questions?

Open an issue on GitHub with the `question` label, or check the [Troubleshooting](troubleshooting.md) page for common issues.
