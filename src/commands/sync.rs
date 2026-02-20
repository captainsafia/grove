use colored::Colorize;

use crate::git::WorktreeManager;

pub fn run(branch: Option<&str>) {
    let manager = match WorktreeManager::discover() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    let target_branch = if let Some(b) = branch {
        b.to_string()
    } else {
        match manager.get_default_branch() {
            Ok(b) => b,
            Err(e) => {
                eprintln!("{} {}", "Error:".red(), e);
                std::process::exit(1);
            }
        }
    };

    // Check if the branch is checked out in any worktree
    if let Ok(worktrees) = manager.list_worktrees() {
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

    if let Err(e) = manager.sync_branch(&target_branch) {
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
