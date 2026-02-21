use chrono::Utc;
use colored::Colorize;

use crate::git::{
    discover_repo, get_default_branch, is_branch_merged, list_worktrees, remove_worktrees,
    DETACHED_HEAD,
};
use crate::models::Worktree;
use crate::utils::parse_duration;

pub fn run(dry_run: bool, force: bool, base: Option<&str>, older_than: Option<&str>) {
    if older_than.is_some() && base.is_some() {
        eprintln!(
            "{} --base and --older-than cannot be used together (--base is ignored when --older-than is specified)",
            "Error:".red()
        );
        std::process::exit(1);
    }

    // Parse the older-than duration if provided
    let age_threshold_ms = if let Some(duration_str) = older_than {
        match parse_duration(duration_str) {
            Ok(ms) => Some(ms),
            Err(e) => {
                eprintln!("{} {}", "Error:".red(), e);
                std::process::exit(1);
            }
        }
    } else {
        None
    };

    let repo = match discover_repo() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    // Get the base branch
    let base_branch = if older_than.is_none() {
        if let Some(b) = base {
            b.to_string()
        } else {
            match get_default_branch(&repo) {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("{} {}", "Error:".red(), e);
                    std::process::exit(1);
                }
            }
        }
    } else {
        String::new()
    };

    let worktrees = match list_worktrees(&repo) {
        Ok(wts) => wts,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    let mut candidates: Vec<Worktree> = Vec::new();

    for wt in &worktrees {
        if wt.is_main || wt.is_locked || wt.branch == DETACHED_HEAD {
            continue;
        }
        if !base_branch.is_empty() && wt.branch == base_branch {
            continue;
        }

        if let Some(threshold_ms) = age_threshold_ms {
            let cutoff = Utc::now() - chrono::Duration::milliseconds(threshold_ms as i64);
            if wt.created_at.timestamp() == 0 || wt.created_at > cutoff {
                continue;
            }
            candidates.push(wt.clone());
        } else {
            match is_branch_merged(&repo, &wt.branch, &base_branch) {
                Ok(true) => candidates.push(wt.clone()),
                Ok(false) => {}
                Err(e) => {
                    if !dry_run {
                        eprintln!(
                            "{} Could not check merge status for branch '{}': {}",
                            "Warning:".yellow(),
                            wt.branch,
                            e
                        );
                    }
                }
            }
        }
    }

    if candidates.is_empty() {
        if older_than.is_some() {
            println!(
                "{}",
                "No worktrees found older than the specified duration.".yellow()
            );
        } else {
            println!("{}", "No worktrees found with merged branches.".yellow());
        }
        return;
    }

    if older_than.is_some() {
        println!(
            "{}",
            format!(
                "Found {} worktree(s) older than {}:",
                candidates.len(),
                older_than.unwrap()
            )
            .green()
        );
    } else {
        println!(
            "{}",
            format!(
                "Found {} worktree(s) with merged branches:",
                candidates.len()
            )
            .green()
        );
    }
    println!();

    for wt in &candidates {
        println!("  {}", wt.path.bold());
        println!("    {}", format!("Branch: {}", wt.branch).dimmed());
        let status = get_worktree_status(wt);
        println!("    {}", format!("Status: {}", status).dimmed());
        if wt.created_at.timestamp() != 0 {
            println!(
                "    {}",
                format!("Created: {}", wt.created_at.format("%Y-%m-%d")).dimmed()
            );
        }
        println!();
    }

    if dry_run {
        println!(
            "{}",
            "This was a dry run. Remove --dry-run flag to actually remove the worktrees.".blue()
        );
        return;
    }

    if !force {
        let dirty_count = candidates.iter().filter(|wt| wt.is_dirty).count();
        let msg = if dirty_count > 0 {
            format!(
                "Remove {} worktree(s)? {} {} uncommitted changes that will be lost.",
                candidates.len(),
                dirty_count,
                if dirty_count == 1 { "has" } else { "have" }
            )
        } else {
            format!("Remove {} worktree(s)?", candidates.len())
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

    println!("{}", "\nRemoving worktrees...".blue());

    let (removed, failed) = remove_worktrees(&repo, &candidates, true);

    for path in &removed {
        println!("{}", format!("✓ Removed worktree: {}", path).green());
    }

    for (path, error) in &failed {
        println!(
            "{}",
            format!("✗ Failed to remove {}: {}", path, error).red()
        );
    }

    if !removed.is_empty() {
        println!(
            "{}",
            format!(
                "\nPrune operation completed. Removed {} worktree(s).",
                removed.len()
            )
            .green()
        );
    }

    if !failed.is_empty() {
        println!(
            "{}",
            format!("\nFailed to remove {} worktree(s).", failed.len()).yellow()
        );
    }
}

fn get_worktree_status(wt: &Worktree) -> String {
    let mut statuses = Vec::new();
    if wt.is_dirty {
        statuses.push("dirty");
    }
    if wt.is_prunable {
        statuses.push("prunable");
    }
    if statuses.is_empty() {
        "clean".to_string()
    } else {
        statuses.join(", ")
    }
}
