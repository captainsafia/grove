# Changelog

<a name="v2.0.0"></a>
## [v2.0.0] - 2026-02-22

### Features
- Add bootstrapping support to the add command (#58)
- Migrate grove from TypeScript to Rust (#56)
- Add platform helpers for shell and self-update (#56)
- Move CLI validation into clap parsers (#56)
- Add agent skill for grove development (#51)
- Use worktree picker for remove and improve handling of existing default branch worktree in `sync` (#47)

### Bug Fixes
- Align add command path output (#58)
- Return exit code 1 for invalid commands (#56)
- Harden Windows version update step (#56)
- Avoid non-TTY `go` recursion (#56)
- Harden handling for `shell-init` methods (#56)
- Update Hone URL to official site (#51)

### Documentation
- Document bootstrap config in README and site (#58)
- Update agents platform support for Windows (#58)

### Tests
- Share temp dir helper and add bootstrap Hone tests (#58)
- Fix invalid URL exit code assertion (#58)
- Add Hone integration tests (#48)

### Chores
- Remove duplicate executable entry in release workflow (#61)
- Refactor git worktree API and add fmt checks (#56)
- Switch PR build to `pull_request` (#56)
- Restore Windows builds and docs (#56)
- Switch back to `pull_request_target` (#56)
- Fix up changelog generation (#57)
- Move skill to `.agents` directory and clarify Hone usage (#51)
- Add changelog generation to workflow (#46)

### Other
- Windows platform fixes for self-update and go (#54)

<a name="v1.4.0"></a>
## [v1.4.0] - 2026-01-26

### Features
- Revamp the site UX (#42)

### Bug Fixes
- Skip update checks during `shell-init`
- Avoid extra filtering on the selected worktree
- Handle non-TTY sessions and cancellation

### Chores
- Add changelog generation to the workflow
- Switch install/download URLs to `i.safia.sh`

<a name="v1.3.0"></a>
## [v1.3.0] - 2026-01-10

### Other
- Enable Windows/PowerShell support and releases (#39)

<a name="v1.2.0"></a>
## [v1.2.0] - 2026-01-06

### Features
- Support checking out PRs to a worktree (#36)

### Bug Fixes
- Use `i.captainsafia.sh` for install URLs and reduce artifact retention (#35)
- Use package version when generating PR versions

<a name="v1.1.0"></a>
## [v1.1.0] - 2025-12-31

### Features
- Add update notifications using `gh-release-update-notifier` (#30)
- Allow running Grove from any directory (#29)
- Discover bare clones from the project root directory

### Bug Fixes
- Log update warnings to stderr instead of stdout (#33)
- Support downloads over the current install (#31)

<a name="v1.0.0"></a>
## [v1.0.0] - 2025-12-21

### Features
- Stream worktree output in `list` (#25)
- Use argument arrays for shell command construction in `self-update`
- Add human-friendly duration formats for `prune --older-than` (#24)
- Add `go` command support (#13)
- Add `self-update` command support (#10)
- Add `sync` command support for updating bare clones (#9)
- Add `add` and `remove` command support
- Migrate the codebase to TypeScript (#1)
- Add `prune --older-than` support

### Bug Fixes
- Remove `--yes` on `prune` and hardcode package versions (#26)
- Handle squash merges in the `prune` command
- Avoid skipping uncommitted changes in `prune`
- Return non-zero exit codes when `remove`/`prune` fail with dirty worktrees (#23)
- Replace string interpolation with argument arrays in `self-update` command construction (#22)
- Make `--force` skip the confirmation prompt in `prune` (#20)
- Add aliases and fix command outputs (#19)
- Update command outputs (#17)
- Handle assorted edge cases (#12)
- Update `init` command output (#6)
- Update `list` output formatting
- Allow `add` on a new branch
- Pass `--force` through to worktree remove (#5)
- Fix worktree list streaming to close #3 (#4)

### Refactors
- Extract filter logic into a helper function

### Documentation
- Polish up the docs site (#27)
- Clarify intentional test duplication in command construction tests
- Document human-friendly duration formats for `prune --older-than`
- Add `AGENTS.md` for consistency (#21)
- Update README
- Add site content

### Tests
- Remove command construction tests per feedback
- Add more test coverage (#11)
- Add the initial test suite

### Chores
- Update release steps for binary releases (#28)
- Remove `package-lock.json` and add it to `.gitignore`
- Harden the install script for preview releases (#18)
- Add JIT entitlements for macOS signing (#16)
- Add notarization for macOS binaries (#15)
- Update `install.sh` for different shells (#8)
- Fix script and release workflows for versions
- Bunify and build executables (#7)
- Add PR publish workflow and prune others
- Remove a duplicate test
- Try updating npm in release jobs
- Remove `NODE_TOKEN` in favor of trusted publish
- Update `package-lock.json`
- Run `go mod tidy`
- Update the goreleaser config

### Other
- Remove Windows build support (#14)
