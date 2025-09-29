# Grove

A CLI tool for managing Git worktrees.

## Features

- **List worktrees** with creation dates and dirty status
- **Prune worktrees** associated with branches merged to main

## Installation

### Download Binary

Download the latest release from [GitHub Releases](https://github.com/captainsafia/grove/releases).

### Go Install

```bash
go install github.com/captainsafia/grove@latest
```

## Usage

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

- `grove list` - List all worktrees
- `grove prune` - Remove worktrees for merged branches
- `grove version` - Show version information
- `grove help` - Show help

## Release Process

To create a new release:

1. Create and push a new tag:

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. GitHub Actions will automatically:
   - Build binaries for Linux, macOS, and Windows
   - Create a GitHub release with binaries
   - Generate checksums
   - Build and push Docker images
   - Update package repositories (Homebrew, Scoop)

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
