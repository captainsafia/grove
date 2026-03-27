use std::collections::HashSet;

use colored::Colorize;

use crate::git::{discover_repo, list_worktrees, remove_worktree};
use crate::models::Worktree;
use crate::utils::trim_trailing_branch_slashes;

pub fn run(names: &[String], force: bool, yes: bool) {
    let repo = match discover_repo() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    let worktrees = match list_worktrees(&repo) {
        Ok(wts) => wts,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    let targets = if names.is_empty() {
        vec![pick_worktree_to_remove(&worktrees)]
    } else {
        match resolve_worktrees_to_remove(&worktrees, names) {
            Ok(targets) => targets,
            Err(e) => {
                eprintln!("{} {}", "Error:".red(), e);
                std::process::exit(1);
            }
        }
    };

    if let Err(e) = validate_worktrees_for_removal(&targets, force) {
        eprintln!("{} {}", "Error:".red(), e);
        std::process::exit(1);
    }

    if !yes && !force {
        let msg = removal_confirmation_message(&targets);

        if !dialoguer::Confirm::new()
            .with_prompt(msg)
            .default(false)
            .interact()
            .unwrap_or(false)
        {
            println!("{}", "Operation cancelled.".blue());
            return;
        }
    }

    let mut failed = Vec::new();

    for worktree in &targets {
        match remove_worktree(&repo, &worktree.path, force) {
            Ok(()) => {
                println!(
                    "{} {}",
                    "✓ Removed worktree:".green(),
                    worktree.branch.bold()
                );

                if force && worktree.is_dirty {
                    eprintln!(
                        "{} Removed dirty worktree '{}' with --force; uncommitted changes were discarded.",
                        "Warning:".yellow(),
                        worktree.branch
                    );
                }
            }
            Err(e) => failed.push((worktree.branch.clone(), e)),
        }
    }

    if !failed.is_empty() {
        for (branch, error) in &failed {
            eprintln!(
                "{} Failed to remove worktree '{}': {}",
                "Error:".red(),
                branch,
                error
            );
        }
        std::process::exit(1);
    }
}

fn find_worktree_by_identifier<'a>(
    worktrees: &'a [Worktree],
    identifier: &str,
) -> Option<&'a Worktree> {
    let trimmed_identifier = identifier.trim();
    let normalized_branch = trim_trailing_branch_slashes(trimmed_identifier);
    let normalized_path = trimmed_identifier.trim_end_matches('/');

    worktrees.iter().find(|wt| {
        wt.path == trimmed_identifier
            || wt.path.trim_end_matches('/') == normalized_path
            || (!normalized_branch.is_empty()
                && (wt.branch == normalized_branch
                    || wt.path.ends_with(&format!("/{}", normalized_branch))))
    })
}

fn resolve_worktrees_to_remove(
    worktrees: &[Worktree],
    identifiers: &[String],
) -> Result<Vec<Worktree>, String> {
    let mut resolved = Vec::new();
    let mut seen_paths = HashSet::new();

    for identifier in identifiers {
        let trimmed_identifier = identifier.trim();
        if trimmed_identifier.is_empty() {
            continue;
        }

        let worktree =
            find_worktree_by_identifier(worktrees, trimmed_identifier).ok_or_else(|| {
                format!(
                    "Worktree '{}' not found. Use 'grove list' to see available worktrees.",
                    trimmed_identifier
                )
            })?;

        if seen_paths.insert(worktree.path.clone()) {
            resolved.push(worktree.clone());
        }
    }

    if resolved.is_empty() {
        return Err(
            "No worktrees specified. Provide one or more names, or run the command interactively."
                .to_string(),
        );
    }

    Ok(resolved)
}

fn validate_worktrees_for_removal(worktrees: &[Worktree], force: bool) -> Result<(), String> {
    for worktree in worktrees {
        if worktree.is_main {
            return Err(format!(
                "Cannot remove the main worktree ({}). This is the primary worktree.",
                worktree.branch
            ));
        }

        if worktree.is_locked {
            return Err(format!(
                "Worktree '{}' is locked. Unlock it first with 'git worktree unlock'.",
                worktree.branch
            ));
        }

        if worktree.is_dirty && !force {
            return Err(format!(
                "Worktree '{}' has uncommitted changes. Use --force to remove it anyway, or commit/stash your changes first.",
                worktree.branch
            ));
        }
    }

    Ok(())
}

fn removal_confirmation_message(worktrees: &[Worktree]) -> String {
    let branches: Vec<&str> = worktrees.iter().map(|wt| wt.branch.as_str()).collect();
    if worktrees.len() == 1 {
        format!(
            "Are you sure you want to remove the worktree for '{}'?",
            branches[0]
        )
    } else {
        format!(
            "Are you sure you want to remove these {} worktrees: {}?",
            worktrees.len(),
            branches.join(", ")
        )
    }
}

fn pick_worktree_to_remove(worktrees: &[Worktree]) -> Worktree {
    let removable: Vec<&Worktree> = worktrees
        .iter()
        .filter(|wt| !wt.is_main && !wt.is_locked)
        .collect();

    if removable.is_empty() {
        eprintln!("{}", "No worktrees found.".yellow());
        std::process::exit(1);
    }

    if !atty::is(atty::Stream::Stdin) {
        eprintln!("{}", "Error: Interactive selection requires a TTY.".red());
        eprintln!(
            "{}",
            "Provide a branch name argument or use 'grove list' instead.".dimmed()
        );
        std::process::exit(1);
    }

    let items: Vec<String> = removable
        .iter()
        .map(|wt| format!("{} ({})", wt.branch, wt.path))
        .collect();

    let selection: Result<Option<usize>, _> = dialoguer::FuzzySelect::new()
        .with_prompt("Select a worktree to remove (type to search)")
        .items(&items)
        .interact_opt();

    match selection {
        Ok(Some(idx)) => removable[idx].clone(),
        _ => {
            println!("{}", "Selection cancelled.".dimmed());
            std::process::exit(0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        find_worktree_by_identifier, removal_confirmation_message, resolve_worktrees_to_remove,
        validate_worktrees_for_removal,
    };
    use crate::models::Worktree;
    use chrono::DateTime;

    fn make_worktree(path: &str, branch: &str) -> Worktree {
        Worktree {
            path: path.to_string(),
            branch: branch.to_string(),
            head: "abc123".to_string(),
            created_at: DateTime::from_timestamp(0, 0).unwrap(),
            is_dirty: false,
            is_locked: false,
            is_prunable: false,
            is_main: false,
        }
    }

    #[test]
    fn find_worktree_by_identifier_matches_branch_with_trailing_slash() {
        let worktrees = vec![make_worktree(
            "/repo/feature/my-branch",
            "feature/my-branch",
        )];

        let found = find_worktree_by_identifier(&worktrees, "feature/my-branch/");
        assert_eq!(
            found.map(|wt| wt.branch.as_str()),
            Some("feature/my-branch")
        );
    }

    #[test]
    fn find_worktree_by_identifier_matches_path_with_trailing_slash() {
        let worktrees = vec![make_worktree(
            "/repo/feature/my-branch",
            "feature/my-branch",
        )];

        let found = find_worktree_by_identifier(&worktrees, "/repo/feature/my-branch/");
        assert_eq!(
            found.map(|wt| wt.branch.as_str()),
            Some("feature/my-branch")
        );
    }

    #[test]
    fn resolve_worktrees_to_remove_deduplicates_matches() {
        let worktrees = vec![
            make_worktree("/repo/feature/one", "feature/one"),
            make_worktree("/repo/feature/two", "feature/two"),
        ];

        let resolved = resolve_worktrees_to_remove(
            &worktrees,
            &[
                "feature/one".to_string(),
                "/repo/feature/one".to_string(),
                "feature/two".to_string(),
            ],
        )
        .unwrap();

        let branches: Vec<&str> = resolved.iter().map(|wt| wt.branch.as_str()).collect();
        assert_eq!(branches, vec!["feature/one", "feature/two"]);
    }

    #[test]
    fn resolve_worktrees_to_remove_errors_when_identifier_missing() {
        let worktrees = vec![make_worktree("/repo/feature/one", "feature/one")];

        let err =
            resolve_worktrees_to_remove(&worktrees, &["feature/two".to_string()]).unwrap_err();

        assert!(err.contains("feature/two"));
    }

    #[test]
    fn validate_worktrees_for_removal_blocks_dirty_without_force() {
        let mut dirty = make_worktree("/repo/feature/dirty", "feature/dirty");
        dirty.is_dirty = true;

        let err = validate_worktrees_for_removal(&[dirty], false).unwrap_err();

        assert!(err.contains("--force"));
    }

    #[test]
    fn validate_worktrees_for_removal_allows_dirty_with_force() {
        let mut dirty = make_worktree("/repo/feature/dirty", "feature/dirty");
        dirty.is_dirty = true;

        assert!(validate_worktrees_for_removal(&[dirty], true).is_ok());
    }

    #[test]
    fn removal_confirmation_message_formats_multiple_worktrees() {
        let worktrees = vec![
            make_worktree("/repo/feature/one", "feature/one"),
            make_worktree("/repo/feature/two", "feature/two"),
        ];

        let message = removal_confirmation_message(&worktrees);

        assert_eq!(
            message,
            "Are you sure you want to remove these 2 worktrees: feature/one, feature/two?"
        );
    }
}
