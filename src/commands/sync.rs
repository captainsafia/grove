use colored::Colorize;

use crate::git::{discover_repo, get_default_branch, list_worktrees, sync_branch};

pub fn run(branch: Option<&str>) {
    let repo = match discover_repo() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    let target_branch = if let Some(b) = branch {
        b.to_string()
    } else {
        match get_default_branch(&repo) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("{} {}", "Error:".red(), e);
                std::process::exit(1);
            }
        }
    };

    // Check if the branch is checked out in any worktree
    if let Ok(worktrees) = list_worktrees(&repo) {
        if worktrees.iter().any(|wt| wt.branch == target_branch) {
            println!(
                "{}",
                format!(
                    "Branch '{}' is checked out in a worktree. Git won't sync against a checked-out branch (a limitation of git worktrees).",
                    target_branch
                )
                .yellow()
            );
            println!(
                "{}",
                format!(
                    "Run 'git fetch origin', then merge or rebase from 'origin/{}'.",
                    target_branch
                )
                .yellow()
            );
            std::process::exit(1);
        }
    }

    if let Err(e) = sync_branch(&repo, &target_branch) {
        eprintln!("{} {}", "Error:".red(), e);
        std::process::exit(1);
    }

    println!(
        "{} {} {}",
        "✓ Synced".green(),
        target_branch.bold(),
        "from origin".dimmed()
    );
}
