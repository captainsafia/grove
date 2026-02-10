---
name: grove
description: |
  Development skill for the Grove CLI repository - a TypeScript Git worktree management tool built with Bun.
  Use when working on grove features, bug fixes, or maintenance tasks.
  Covers: development workflow, code patterns, testing, commands structure, and commit conventions.
---

# Grove Development

## Project Stack
- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **CLI Framework**: Commander.js
- **Git Operations**: simple-git library
- **Testing**: Bun's built-in test runner

## Development Workflow

### Before committing
```bash
bun run typecheck   # Type check
bun test            # Run all tests
```

### Common commands
```bash
bun install         # Install dependencies
bun run dev         # Run in development mode
bun run build       # Build to dist/
bun run build:compile  # Build single executable
```

## Code Patterns

### Adding a new command
1. Create `src/commands/<name>.ts` with factory function:
```typescript
import { Command } from "commander";
import { handleCommandError } from "../utils";

export function create<Name>Command(): Command {
  return new Command("<name>")
    .description("Short description")
    .argument("<arg>", "Argument description")
    .option("-f, --flag", "Flag description")
    .action(async (arg, options) => {
      try {
        // Implementation
      } catch (error) {
        handleCommandError(error);
      }
    });
}
```

2. Register in `src/index.ts`:
```typescript
import { create<Name>Command } from "./commands/<name>";
program.addCommand(create<Name>Command());
```

### Git operations
Use `WorktreeManager` class instead of calling git directly:
```typescript
const manager = await WorktreeManager.discover();
// Use manager methods for git operations
```

### Error handling
```typescript
import { formatError, formatWarning, handleCommandError } from "../utils";
// In action handlers, wrap with try/catch calling handleCommandError
```

### Interfaces
Define in `src/models/index.ts`

## Testing

### Structure
- **Unit tests**: `test/unit/*.test.ts` - Uses Bun's built-in test runner
- **Integration tests**: `test/integration/*.hone` - Uses [Hone](https://github.com/nicholasgrose/hone) CLI testing framework

### Unit test pattern
```typescript
import { describe, test, expect, mock } from "bun:test";

describe("FeatureName", () => {
  test("should do something", () => {
    expect(result).toBe(expected);
  });
});
```

### Running tests
```bash
bun test              # Unit tests only
bun run test:integration  # Builds executable, runs Hone tests
```

## Commit Messages
Use Conventional Commits format:
```
<type>: <subject>
```

Types: `feat`, `fix`, `chore`, `test`, `doc`

Rules:
- Lowercase type and subject
- No period at end
- Imperative mood ("add" not "added")
- Under 72 characters

Examples:
```
feat: add support for branch tracking
fix: handle missing git config gracefully
chore: update dependencies
test: add edge case tests for prune
doc: update readme with new command
```

## Documentation
When adding/changing commands:
1. Update `README.md` Commands section
2. Update `site/index.html` to match (keep in sync)

## Platform Support
Linux and macOS only (x64, arm64). No Windows code.
