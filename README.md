# grove

<div align="center">
  <img src="site/logo.png" alt="Grove Logo" width="200"/>
</div>

Grove is a CLI tool that encapsulates the patterns that I use for working with Git worktrees locally on my machine. To learn more about this pattern, you can check out [this blog post](https://blog.safia.rocks/2025/09/03/git-worktrees/).

## Features

- Initialize repos with a bare clone optimized for worktrees
- Create, list, and remove worktrees
- Sync with origin and prune stale worktrees
- Self-update to the latest version or PR build

## Installation

### Quick Install (Linux/macOS)

```bash
curl -fsSL https://safia.rocks/grove/install.sh | sh
```

This will download the appropriate binary for your system and install it to `~/.grove/bin`.

**Note:** Grove currently supports Linux and macOS only. Windows support is not available.

To install a specific version:

```bash
curl -fsSL https://safia.rocks/grove/install.sh | sh -s -- v1.0.0
```

## Usage

### Initialize a new worktree setup

Create a new directory structure optimized for git worktree workflows:

```bash
grove init https://github.com/user/repo.git
```

This command will:

- Create a directory named after the repository (e.g., `repo/`)
- Clone the repository as a bare clone into `repo/repo.git/`
- Configure the remote fetch to support all branches
- Provide instructions for creating worktrees

After initialization, you can create worktrees:

```bash
cd repo
grove add main
grove add feature/new-feature
```

### Add a new worktree

Create a new worktree for a branch:

```bash
grove add feature/new-feature
```

Track a remote branch:

```bash
grove add feature/new-feature --track origin/feature/new-feature
```

### Remove a worktree

Remove a worktree:

```bash
grove remove feature/new-feature
```

Force removal even with uncommitted changes:

```bash
grove remove feature/new-feature --force
```

Skip confirmation prompt:

```bash
grove remove feature/new-feature --yes
```

### List all worktrees

```bash
grove list
```

Show detailed information:

```bash
grove list --details
```

Show only dirty worktrees:

```bash
grove list --dirty
```

### Sync with origin

Update the bare clone with the latest changes from origin:

```bash
grove sync
```

This fetches the default branch (main or master) from origin and updates the local reference.

Sync a specific branch:

```bash
grove sync --branch develop
```

### Prune merged worktrees

Preview what would be removed:

```bash
grove prune --dry-run
```

Remove worktrees for branches merged to main:

```bash
grove prune
```

Force removal even if worktrees have uncommitted changes:

```bash
grove prune --force
```

Use a different base branch:

```bash
grove prune --base develop
```

Remove worktrees older than a specific duration (bypasses merge check):

**Note:** When using `--older-than`, the merge status check is bypassed, and all worktrees older than the specified duration will be removed. The `--base` flag cannot be used with `--older-than`.

```bash
# Remove worktrees older than 30 days
grove prune --older-than 30d

# Remove worktrees older than 6 months
grove prune --older-than 6M

# Remove worktrees older than 1 year
grove prune --older-than 1y

# Preview what would be removed for worktrees older than 2 weeks
grove prune --older-than 2w --dry-run
```

### Self-update

Update grove to the latest version:

```bash
grove self-update
```

Update to a specific version:

```bash
grove self-update v1.0.0
# or
grove self-update 1.0.0
```

Update to a specific PR build (requires GitHub CLI):

```bash
grove self-update --pr 42
```

**Note:** The self-update command uses the same installation script as the initial installation. If you installed grove using the quick install method, this command will update the binary in `~/.grove/bin`. If you installed grove using a different method (e.g., manually downloading the binary), you may need to update it manually.

## Commands

- `grove init <git-url>` - Create a new worktree setup
- `grove add <name> [options]` - Create a new worktree
- `grove remove <name> [options]` - Remove a worktree
- `grove list [options]` - List all worktrees
- `grove sync [options]` - Sync the bare clone with origin
- `grove prune [options]` - Remove worktrees for merged branches
- `grove self-update [version] [options]` - Update grove to a specific version or PR
- `grove version` - Show version information
- `grove help [command]` - Show help

## Development

### Prerequisites

- Node.js 20.0 or later
- Bun (https://bun.sh)
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/captainsafia/grove.git
cd grove

# Install dependencies
bun install

# Build the project
bun run build

# Build single-file executable
bun run build:compile
```

### Development Commands

```bash
# Build the project
bun run build

# Build single-file executable for current platform
bun run build:compile

# Cross-compile for specific platforms
bun run build:linux-x64
bun run build:darwin-arm64

# Type check the code
bun run typecheck

# Run tests
bun test

# Clean build artifacts
bun run clean
```
