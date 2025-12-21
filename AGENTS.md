Instructions for coding agents working on the Grove repository.

## Project Overview

Grove is a CLI tool written in TypeScript that manages Git worktrees. It runs on [Bun](https://bun.sh) and targets Linux and macOS platforms.

**Key technologies:**
- Runtime: Bun
- Language: TypeScript (strict mode)
- CLI Framework: Commander.js
- Git Operations: simple-git library
- Testing: Bun's built-in test runner

## Repository Structure

```
src/
├── index.ts              # CLI entry point, command registration
├── commands/             # One file per CLI command
│   ├── add.ts
│   ├── go.ts
│   ├── init.ts
│   ├── list.ts
│   ├── prune.ts
│   ├── remove.ts
│   ├── self-update.ts
│   └── sync.ts
├── git/
│   └── WorktreeManager.ts  # Core Git worktree operations
├── models/
│   └── index.ts          # TypeScript interfaces
└── utils/
    └── index.ts          # Helper functions

test/
├── unit/                 # Unit tests
└── integration/          # Integration tests

site/                     # GitHub Pages website
├── index.html            # Landing page
└── install.sh            # Installation script
```

## Development Commands

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Type check
bun run typecheck

# Run all tests
bun test

# Run only unit tests
bun run test:unit

# Run only integration tests
bun run test:integration

# Build to dist/
bun run build

# Build single executable for current platform
bun run build:compile
```

Always run `bun run typecheck` and `bun test` before committing changes.

## Updating Documentation

### README.md

The README at the repository root is the primary documentation. When updating:

1. Keep the existing section structure:
   - Features
   - Installation (multiple methods)
   - Quick Start
   - Commands (with examples)
   - Development

2. When adding a new command:
   - Add it to the Commands section with usage syntax and examples
   - Include all flags/options with descriptions
   - Show realistic example output if helpful

3. When changing command behavior:
   - Update the corresponding command documentation
   - Update any affected examples

### Site Documentation (site/)

The `site/` directory contains the GitHub Pages website. The `site/index.html` file is a standalone HTML page with embedded CSS.

When updating site documentation:

1. **Keep README and site in sync** - The site mirrors the README content. If you update README command documentation, update `site/index.html` to match.

2. **Maintain the HTML structure** - The site uses semantic HTML sections:
   - Hero section with tagline
   - Installation section
   - Commands/usage section

3. **Test locally** - Open `site/index.html` in a browser to verify changes render correctly.

4. **Deployment** - The site auto-deploys via GitHub Actions when changes to `site/` are pushed to main.

### install.sh

The `site/install.sh` script is the curl-pipe-bash installer. When modifying:

- Test the script thoroughly on both Linux and macOS
- Maintain support for both x64 and arm64 architectures
- Keep error handling and user feedback intact

## Commit Message Format

This repository uses [Conventional Commits](https://www.conventionalcommits.org/). All commits must follow this format:

```
<type>: <subject>
```

### Types

| Type    | Use For                                           |
|---------|---------------------------------------------------|
| `feat`  | New features or functionality                     |
| `fix`   | Bug fixes                                         |
| `chore` | Build, CI/CD, dependencies, maintenance           |
| `test`  | Adding or updating tests                          |
| `doc`   | Documentation only changes                        |

### Rules

1. **Use lowercase** for type and subject
2. **No period** at the end of the subject
3. **Use imperative mood** ("add" not "added" or "adds")
4. **Keep subject under 72 characters**
5. **Reference PR number** when applicable: `(#123)`

### Examples

```
feat: add support for branch tracking in add command
fix: handle missing git config gracefully
chore: update dependencies to latest versions
test: add edge case tests for prune command
doc: update readme with new installation method
fix: address edge cases in worktree detection (#17)
chore: add notarization for macos binaries (#15)
```

### Multi-line Commits

For complex changes, add a body separated by a blank line:

```
feat: add self-update command

Allows users to update grove to the latest version or a specific
version directly from the CLI. Supports installing PR preview builds
with the --pr flag.
```

## Code Conventions

### Command Files

Each command in `src/commands/` exports a factory function:

```typescript
import { Command } from "commander";

export function createExampleCommand(): Command {
  return new Command("example")
    .description("Short description of command")
    .argument("<required>", "Argument description")
    .option("-f, --flag", "Flag description")
    .action(async (arg, options) => {
      // Implementation
    });
}
```

Register new commands in `src/index.ts`:

```typescript
import { createExampleCommand } from "./commands/example";
program.addCommand(createExampleCommand());
```

### WorktreeManager

Git operations go through `src/git/WorktreeManager.ts`. Extend this class when adding new Git functionality rather than calling git directly in commands.

### Error Handling

Use the utility functions from `src/utils/index.ts`:

```typescript
import { formatError, formatWarning } from "../utils";

console.log(formatError("Something went wrong"));
console.log(formatWarning("Proceed with caution"));
```

### TypeScript

- Strict mode is enabled - no implicit any
- Define interfaces in `src/models/index.ts`
- Use explicit return types for exported functions

### Testing

- Place unit tests in `test/unit/`
- Place integration tests in `test/integration/`
- Name test files as `*.test.ts`
- Use Bun's test utilities from `bun:test`

```typescript
import { describe, test, expect, mock } from "bun:test";

describe("FeatureName", () => {
  test("should do something", () => {
    expect(result).toBe(expected);
  });
});
```

## CI/CD

- **CI runs on all PRs**: Type check, tests, and build verification
- **Releases trigger on tags**: Version tags like `v1.0.0` create releases
- **PR builds**: Each PR gets preview builds with download links posted as comments

## Platform Support

Grove supports:
- Linux (x64, arm64)
- macOS (x64, arm64)

Windows is not supported. Do not add Windows-specific code or workarounds.
