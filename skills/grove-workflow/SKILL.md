---
name: grove-workflow
description: |
  Use grove to obtain and manage a git repo as worktrees - every branch
  in its own directory, no stashing or branch-switching. Reach for it
  first whenever you need a local copy of a repo: before running
  `git clone`, prefer `grove init`. However the need arises: the user
  says "clone", hands you a URL, or you (an agent) decide you need the
  code locally to read, build, or debug. Also use grove to add a
  feature or bugfix branch, switch between in-progress branches, check
  out a pull request, list worktrees, or clean up the ones you're
  finished with. The same when you land in a `<name>.git/` bare clone
  beside worktree directories. Do not wait for the words "grove" or
  "worktree" - cloning, branching, juggling in-flight changes, or PR
  review are strong signals. It is not for read-only GitHub lookups
  that need no local checkout: license, README, issues, releases, or
  code search. Covers grove-repo detection, agent-friendly flags
  (`--path-only`, `--json`), and migrating a pre-existing plain clone.
---

# Grove Workflow

Grove is a CLI that wraps `git worktree` plumbing into a workflow. Every branch lives in its own directory next to a shared bare clone, so many in-progress branches can be checked out at once - no stashing, no `git switch` shuffle, no accidentally testing the wrong tree. Grove owns the project layout and the bookkeeping; you keep using `git`, `gh`, and the rest of your normal tools from inside each worktree.

The full reference lives in `grove --help` (and `grove <subcommand> --help` for individual commands). This skill summarizes what an agent needs to use grove confidently.

## When this skill is loaded, expect tasks like

- "Clone this repo and start working on X"
- "Switch to my login branch"
- "Check out PR 142"
- "Clean up the worktrees I'm done with"
- "Try a quick experiment on a new branch"
- Anything inside a project that has a `<name>.git/` bare clone next to worktree directories

If the user is in plain `git clone` territory and grove is not yet involved, see **Pre-existing non-grove repo** below before running grove commands.

## Agent-mode rule of thumb

In a non-interactive CLI agent context (no TTY, no shell integration), keep two patterns ready: move into a worktree by its path, and read state as JSON.

`grove go --path-only` prints the target path to stdout and nothing else, so command substitution moves you there. This form is identical in bash and PowerShell:

```bash
cd "$(grove go feature/login --path-only)"
```

To reuse the path, capture it with your shell's own syntax - bash `wt=$(grove go feature/login --path-only)`, PowerShell `$wt = grove go feature/login --path-only`.

Enumerate worktrees programmatically:

```bash
grove list --json
```

Without `--path-only`, `grove go` either launches a child shell (which an agent can't navigate from the parent process) or errors on the fuzzy picker (no TTY to read from). Without `--json`, you would be screen-scraping a human-formatted table whose layout is allowed to change.

## Detection: am I in a grove-managed project?

Figure out the repo's shape before running anything. Cheapest checks first:

1. `GROVE_REPO` is set in the environment - grove already discovered the project on a previous command in this shell.
2. `grove list` exits 0 - the most authoritative test, since grove walks up from the cwd to find the project root.
3. A `<name>.git/` directory exists at some ancestor path, sitting alongside one or more worktree directories.
4. A `.groverc` lives at the project root.
5. From inside `<name>.git/`, `git rev-parse --is-bare-repository` returns `true`.

If none of these hold you are in a normal `git clone` (or no repo at all) - go to **Pre-existing non-grove repo**.

## Triage: what to do based on what you found

| Situation | Action |
|---|---|
| Empty directory, user wants to start | `grove init <url>` |
| grove-managed repo (any of 1-5 above) | Use the grove commands below |
| Plain `git clone`, user wants the grove workflow | Recommend a `grove init` re-clone (default); accept fall-back to plain git if they decline |
| Plain `git clone`, user did not ask for grove | Don't migrate. Use plain git. |

The last row matters - re-cloning a user's repo without being asked is surprising in the bad way.

## Cloning a new repo

```bash
grove init https://github.com/owner/repo.git
```

This creates `repo/repo.git/` (the bare clone) inside a fresh `repo/` directory and configures the remote to fetch all branches. From there:

```bash
cd repo
grove add main             # check out main as a worktree
grove add feature/login    # start a new feature branch
```

Skip `git clone`. `grove init` does the cloning, and a normal `git clone` produces a layout grove cannot drive.

## Pre-existing non-grove repo

When the user is already working in a normal clone and the workflow would benefit from grove (multiple branches in flight, frequent PR review, parallel agent work), the default recommendation is to re-clone with `grove init`. The data lives on the remote, so a re-clone is a cheap migration.

Migration recipe:

1. `git status` - if anything is uncommitted, stop and ask the user to commit, push, or stash.
2. Confirm any branch with unpushed commits has been pushed (or the user has accepted the loss).
3. From a sibling directory, run `grove init <remote-url>`.
4. From inside the new directory, `grove list` to confirm the layout.
5. After the user confirms the new directory works, delete the old clone.

Accept a fall-back to plain `git` if the user declines. Reasonable reasons they might: shared machine, exotic remote setup, submodules grove doesn't manage, work in progress they aren't ready to push, CI working directory. Note in your response that grove commands won't work in this repo without re-cloning, then move on - don't keep nagging.

## Starting new work

Named branch:

```bash
grove add feature/new-thing
```

Track an existing remote branch:

```bash
grove add feature/existing --track origin/feature/existing
```

Auto-named (good for short experiments):

```bash
grove add
# Creates e.g. quiet-meadow/ on branch quiet-meadow.
# If .groverc has branchPrefix: "alice", branch becomes alice/quiet-meadow;
# the directory stays quiet-meadow/.
```

`branchPrefix` accepts only alphanumerics, and the directory name never gets the prefix.

If the bare clone might be stale, refresh before branching from the trunk:

```bash
grove sync                   # default branch (main / master)
grove sync --branch develop  # specific branch
```

`grove sync` updates only the bare clone's ref for that branch. Existing worktrees are unaffected and still need their own `git pull` / `git rebase` if you want them on the new tip - one stale worktree shouldn't block syncing the rest of the project.

## Switching to existing work

Interactive (humans, with shell integration installed):

```bash
grove go feature/login    # exact match
grove go login            # partial match
grove go                  # fuzzy picker (needs TTY)
```

Non-interactive (agents):

```bash
cd "$(grove go feature/login --path-only)"
```

`grove go` only sets `GROVE_WORKTREE` when it launches a child shell - that is, in interactive mode. In agent mode you stay in the parent process, so don't rely on the env var.

## Pull request checkout

```bash
grove pr 42
```

Creates a worktree for the head branch of PR #42 using the same naming rules as `grove add`. Requires the `gh` CLI to be installed and authenticated. Use this whenever the task is "review PR 42", "test the changes in PR 42", or anything else that means "I need this PR's code locally" - it is much faster than fetching the PR ref by hand.

## Listing and discovery

```bash
grove list             # human-friendly (alias: grove ls)
grove list --json      # machine-readable - parse this from agents
grove list --details   # extra columns
grove list --dirty     # only worktrees with uncommitted changes
grove list --locked    # only locked worktrees
```

When an agent needs to enumerate or branch on worktree state, use `--json`. The human-formatted table is for humans.

## Cleanup

Remove specific worktrees:

```bash
grove remove feature/new-thing       # alias: grove rm
grove remove feat-a feat-b           # multiple at once
grove remove feat-a --force          # even with uncommitted changes
grove remove feat-a --yes            # skip confirmation
```

Bulk-remove worktrees whose branches were merged to the trunk:

```bash
grove prune --dry-run                # always preview first
grove prune                          # apply
grove prune --base develop           # different trunk
grove prune --older-than 30d         # bypass merge check; use age
grove prune --older-than P30D        # ISO 8601 duration also works
grove prune --force                  # ignore dirty worktrees
```

`--older-than` and `--base` cannot be combined.

The dry-run is not optional in practice. `grove prune` decides what's safe to remove using merge detection, and squashes, rebases, force-pushes, and PR-only branches each confuse the heuristic in different ways. Show the dry-run output to the user, get confirmation, then apply.

## .groverc bootstrap

A `.groverc` at the project root configures grove for that project:

```json
{
  "branchPrefix": "alice",
  "bootstrap": {
    "commands": [
      { "program": "npm", "args": ["install"] },
      { "program": "cargo", "args": ["check"] }
    ]
  }
}
```

When `grove add` creates a worktree, every command runs in order inside the new directory. Three constraints:

- Cross-platform - the same `.groverc` should work on Linux, macOS, and Windows.
- Executable plus args only. No shell metacharacters (`|`, `&&`, `>`, `;`). If you need shell features, run a script and put the shell features inside the script.
- Failures are reported but do not abort the remaining commands.

This is the right place to centralize "every new worktree needs `npm install` and a `cargo check`". It saves the agent from reinventing the install dance for each new worktree.

## Shell integration (humans)

For interactive humans, `grove go` is more useful when it changes the cwd directly instead of spawning a child shell:

```bash
echo 'eval "$(grove shell-init bash)"'  >> ~/.bashrc
echo 'eval "$(grove shell-init zsh)"'   >> ~/.zshrc
echo 'eval "$(grove shell-init fish)"'  >> ~/.config/fish/config.fish
```

PowerShell is also supported (`pwsh`, `powershell`).

Agents should not depend on shell integration being installed - use `--path-only` (see **Switching to existing work**).

## Branch naming tips

- Plain names (`feature/login`, `bugfix/123`) work as both branch name and worktree directory name.
- `--track origin/some-branch` lets you check out an existing remote branch under a different local name.
- Auto-generated names are great for ad-hoc experiments; combined with `branchPrefix`, you get `<user>/<adjective>-<noun>` namespacing for free.
- Grove rejects these characters in branch names: `<`, `>`, `:`, `"`, `|`, `?`, `*`, plus path-traversal sequences (`..`, absolute paths). These are the characters Windows filesystems can't represent, so the rule keeps repos portable.

## Examples

**Clone and start a feature**

User task: *"Clone https://github.com/foo/bar and add a feature branch for OAuth, then drop me into it."*

```bash
grove init https://github.com/foo/bar.git
cd bar
grove add feature/oauth
cd "$(grove go feature/oauth --path-only)"
```

**Switch tasks**

User task: *"I need to look at my login work."*

```bash
cd "$(grove go login --path-only)"
```

The partial match resolves to whichever worktree contains "login" in its branch name. If multiple match, fall back to the full name.

**Review a PR**

User task: *"Pull down PR 142 so I can run the tests."*

```bash
grove pr 142
# grove pr prints the new worktree path on success - cd into it,
# or use grove go --path-only with the new branch name.
```

**Cleanup at end of week**

User task: *"Clean up branches I'm done with."*

```bash
grove prune --dry-run
# Show the user what would be removed; ask for confirmation.
grove prune
```

**Encounter a non-grove repo**

User task (executed inside a plain `git clone`): *"Switch to my login branch in this repo I cloned last month."*

Detection finds no `<name>.git/` and no `.groverc` - this is a plain clone. Tell the user grove won't work here without a re-clone, offer the migration recipe, and proceed with `git switch login` (or whatever they prefer) if they decline.

## What grove does and does not do

Grove owns: project layout (`init`), worktree lifecycle (`add`, `remove`, `prune`, `pr`), navigation (`go`), discovery (`list`), and upstream sync (`sync`).

Grove does not replace `git` or `gh`. From inside a worktree, keep using:

- `git status`, `git diff`, `git add`, `git commit`, `git push`
- `git rebase`, `git merge`, `git cherry-pick`
- `gh pr create`, `gh issue list`, `gh pr review`

If you reach for `git worktree add`, that's the cue to use `grove add` instead - grove keeps a consistent directory layout that the rest of these commands depend on. If you reach for `git clone` and the user wants the grove workflow, use `grove init`. If you want to `cd` into the `<name>.git/` bare clone to do work, redirect into a worktree - the bare clone has no working tree, only refs.

## Why these constraints exist

A few rules earn their keep:

- **Don't run grove against a non-bare clone.** Discovery walks up looking for the bare-clone signature; in a normal clone it won't find one and every grove command will fail. That's a feature - grove is telling you the layout is wrong, not the command.

- **Don't `git worktree add` in a grove-managed repo.** Grove tracks worktrees through git's standard mechanisms, so a hand-rolled `git worktree add` will appear in `grove list` - but the directory layout, branch naming, and bootstrap won't match. The inconsistency bites later.

- **Always preview pruning.** `grove prune` decides what's safe to remove based on merge detection, and the heuristics aren't perfect. The dry-run is the chance to catch a false positive before a worktree is gone.

- **`grove sync` is not `git pull`.** It updates only the bare clone's ref for the named branch. Worktrees stay where they were until you pull or rebase them yourself. This is intentional - one stale worktree shouldn't block syncing the rest of the project.
