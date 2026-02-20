use colored::Colorize;

use crate::git::WorktreeManager;
use crate::models::Worktree;

pub fn run(name: Option<&str>, force: bool, yes: bool) {
    let manager = match WorktreeManager::discover() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    let worktrees = match manager.list_worktrees() {
        Ok(wts) => wts,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    let worktree: Worktree = if let Some(name) = name {
        if name.trim().is_empty() {
            pick_worktree_to_remove(&worktrees)
        } else {
            match worktrees.iter().find(|wt| {
                wt.branch == name
                    || wt.path == name
                    || wt.path.ends_with(&format!("/{}", name))
            }) {
                Some(wt) => wt.clone(),
                None => {
                    eprintln!(
                        "{} Worktree '{}' not found. Use 'grove list' to see available worktrees.",
                        "Error:".red(),
                        name
                    );
                    std::process::exit(1);
                }
            }
        }
    } else {
        pick_worktree_to_remove(&worktrees)
    };

    if worktree.is_main {
        eprintln!(
            "{} Cannot remove the main worktree ({}). This is the primary worktree.",
            "Error:".red(),
            worktree.branch
        );
        std::process::exit(1);
    }

    if worktree.is_locked {
        eprintln!(
            "{} Worktree '{}' is locked. Unlock it first with 'git worktree unlock'.",
            "Error:".red(),
            worktree.branch
        );
        std::process::exit(1);
    }

    // Block removal of dirty worktrees without --force
    if worktree.is_dirty && !force {
        println!(
            "{}",
            "Warning: This worktree has uncommitted changes.".yellow()
        );
        println!(
            "{}",
            "Use --force to remove it anyway, or commit/stash your changes first.".yellow()
        );
        std::process::exit(1);
    }

    // Confirm removal
    if !yes {
        let msg = if worktree.is_dirty {
            format!(
                "Are you sure you want to remove the worktree for '{}'? Uncommitted changes will be lost!",
                worktree.branch
            )
        } else {
            format!(
                "Are you sure you want to remove the worktree for '{}'?",
                worktree.branch
            )
        };

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

    if let Err(e) = manager.remove_worktree(&worktree.path, force) {
        eprintln!("{} {}", "Error:".red(), e);
        std::process::exit(1);
    }

    println!(
        "{} {}",
        "✓ Removed worktree:".green(),
        worktree.branch.bold()
    );
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
