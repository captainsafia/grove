# grove

<div align="center">
  <img src="site/logo.png" alt="Grove Logo" width="200"/>
</div>

Grove is a CLI tool that encapsulates the patterns that I use for working with Git worktrees locally on my machine. To learn more about this pattern, you can check out [this blog post](https://blog.safia.rocks/2025/09/03/git-worktrees/).

## Features

- Initialize repos with a bare clone optimized for worktrees
- Create, list, and remove worktrees
- Sync with origin and prune stale worktrees
- Run commands from anywhere within the project hierarchy
- Shell integration for seamless directory navigation
- Self-update to the latest version or PR build

## Installation

### Quick Install (Linux/macOS)

```bash
curl https://i.safia.sh/captainsafia/grove | sh
```

This will download the appropriate binary for your system and install it to `~/.grove/bin`.

To install a specific version:

```bash
curl https://i.safia.sh/captainsafia/grove/v1.0.0 | sh
```

### Quick Install (Windows)

```powershell
irm https://i.safia.sh/captainsafia/grove | iex
```

This will download the appropriate binary for your system and install it to `%LOCALAPPDATA%\grove\bin`.

To install a specific version:

```powershell
irm https://i.safia.sh/captainsafia/grove/v1.0.0 | iex
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

Run a bootstrap script or command after worktree creation (e.g. install dependencies, audit, setup):

```bash
# Run a script file
grove add feature/new-feature --bootstrap ./scripts/setup.sh

# Run a command directly
grove add feature/new-feature --bootstrap "npm install"
grove add feature/new-feature --bootstrap "bun install"
```

Scripts and commands run with the worktree as the current directory. If the argument is a path to an existing file, it runs as a script; otherwise it runs as a shell command.

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

### Navigate to a worktree

Open a new shell session in a worktree directory:

```bash
grove go feature-branch
```

This spawns a new shell in the worktree directory. Exit the shell (Ctrl+D or `exit`) to return to your previous directory.

You can also navigate by partial branch name for nested branches:

```bash
# If you have a worktree for feature/my-feature
grove go my-feature
```

The `GROVE_WORKTREE` environment variable is set to the branch name while in the worktree shell.

#### Shell Integration

For a smoother experience, you can set up shell integration so `grove go` changes your current directory instead of spawning a new shell:

**Bash:**
```bash
echo 'eval "$(grove shell-init bash)"' >> ~/.bashrc
source ~/.bashrc
```

**Zsh:**
```bash
echo 'eval "$(grove shell-init zsh)"' >> ~/.zshrc
source ~/.zshrc
```

**Fish:**
```bash
echo 'eval "$(grove shell-init fish)"' >> ~/.config/fish/config.fish
source ~/.config/fish/config.fish
```

**PowerShell:**

Add this line to your PowerShell profile (`$PROFILE`):

```powershell
Invoke-Expression (grove shell-init pwsh)
```

To edit your profile, run `notepad $PROFILE`, then restart PowerShell.

With shell integration enabled, `grove go feature-branch` will directly change your working directory.

### Run Commands from Anywhere

Grove commands work from anywhere within your project hierarchy - you don't need to be in the bare clone directory. Whether you're deep inside a worktree's source code or at the project root, grove automatically discovers the repository:

```bash
# Works from inside a worktree
cd ~/projects/myproject/feature-branch/src/components
grove list  # Discovers and lists all worktrees

# Works from the worktree root
cd ~/projects/myproject/feature-branch
grove add another-feature

# Works from the bare clone
cd ~/projects/myproject/myproject.git
grove sync
```

Grove caches the discovered repository path in the `GROVE_REPO` environment variable for faster subsequent commands.

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

You can use human-friendly formats (e.g., `30d`, `2w`, `6M`, `1y`) or ISO 8601 duration format (e.g., `P30D`, `P2W`, `P6M`, `P1Y`):

```bash
# Remove worktrees older than 30 days
grove prune --older-than 30d

# Remove worktrees older than 6 months
grove prune --older-than 6M

# Remove worktrees older than 1 year
grove prune --older-than 1y

# Preview what would be removed for worktrees older than 2 weeks
grove prune --older-than 2w --dry-run

# ISO 8601 format is also supported
grove prune --older-than P30D
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
- `grove go <name>` - Navigate to a worktree
- `grove remove <name> [options]` - Remove a worktree
- `grove list [options]` - List all worktrees
- `grove sync [options]` - Sync the bare clone with origin
- `grove prune [options]` - Remove worktrees for merged branches
- `grove shell-init <shell>` - Output shell integration function (bash, zsh, or fish)
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
