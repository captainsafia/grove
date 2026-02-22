---
name: generate-changelog
description: Generate a changelog from conventional commits in this repository. Use when asked to generate, create, or update a changelog, release notes, or summarize changes between versions/tags/refs. Handles both top-level conventional commit prefixes and conventional commits embedded in squash merge commit bodies.
---

# Generate Changelog

## Workflow

1. Determine the commit range from user input (two tags, a tag and HEAD, etc.). If not specified, detect the two most recent release tags (matching `vX.Y.Z` without `-preview`) via `git tag --list 'v*' --sort=-version:refname`.
2. Retrieve commits with full bodies:
   ```
   git --no-pager log --format="__COMMIT__%H%n%s%n%b__END__" <from>..<to>
   ```
3. Extract conventional commit entries from each commit using the rules below.
4. Format and output the changelog.

## Extracting Conventional Commits

This repo uses squash merges. Conventional commit prefixes may appear in two places:

- **Top-level subject line** — e.g. `feat: add worktree picker (#47)`
- **Body of a squash merge** — individual commits listed as `* feat: ...` or `* fix: ...` lines in the commit body. The top-level subject may lack a conventional prefix entirely.

For each commit:
1. If the subject matches `<type>: <description>`, record it as a single entry with that type.
2. Always scan the body for lines matching `* <type>: <description>` (where `*` may also be `-`). Record each as a separate entry. If the subject already had a conventional prefix, do not double-count entries that duplicate the subject.
3. If neither the subject nor any body line has a conventional prefix, categorize the commit as `other`.

Recognized types and their changelog categories:
- `feat` → **Features**
- `fix` → **Bug Fixes**
- `docs` / `doc` → **Documentation**
- `chore` → **Chores**
- `test` → **Tests**
- `refactor` → **Refactors**
- `perf` → **Performance**
- `ci` → **CI**
- `style` → **Style**
- Anything else → **Other**

## Formatting

Output the changelog in Markdown:

```
## [<version>] - YYYY-MM-DD

### Features
- Description of change (#PR)

### Bug Fixes
- Description of change (#PR)

...
```

Rules:
- Use the target tag (or "Unreleased" if targeting HEAD) as the version header.
- Get the date from the tagged commit (`git log -1 --format=%as <tag>`). For HEAD, use today's date.
- Group entries by category. Omit empty categories.
- Order categories: Features, Bug Fixes, Refactors, Performance, Documentation, Tests, CI, Chores, Style, Other.
- Rewrite each entry as a clear, user-friendly description (not a raw commit message). Remove redundant type prefixes.
- Preserve PR references like `(#47)` at the end of each bullet.
- Do not include merge commits or entries that are purely version bumps (`chore: bump package version`) unless the user explicitly asks for them.
