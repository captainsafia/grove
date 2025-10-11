# grove

<div align="center">
  <img src="assets/logo.png" alt="Grove Logo" width="200"/>
</div>

Grove is a CLI tool that encapsulates the patterns that I use for working with Git worktrees locally on my machine. To learn more about this pattern, you can check out [this blog post](https://blog.safia.rocks/2025/09/03/git-worktrees/).

## Features

- Create new Git repo setup with a bare clone to support worktrees
- List worktrees with creation dates and dirty status
- Prune worktrees associated with branches merged to main

## Installation

### Download Binary

Download the latest release from [GitHub Releases](https://github.com/captainsafia/grove/releases).

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
git worktree add main main
git worktree add feature/new-feature origin/feature/new-feature
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

## Commands

- `grove init` - Create a new worktree setup
- `grove list` - List all worktrees
- `grove prune` - Remove worktrees for merged branches
- `grove version` - Show version information
- `grove help` - Show help

## Development

### Prerequisites

- Go 1.23 or later
- Git

### Build

```bash
go build -o grove .
```

### Test

```bash
go test ./...
```
