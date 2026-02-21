use colored::Colorize;
use std::process::Command;

use crate::git::WorktreeManager;
use crate::models::Worktree;
use crate::commands::shell_init::{should_show_shell_tip, mark_shell_tip_shown, get_shell_setup_instructions};
use crate::utils::get_shell_for_platform;

pub fn run(name: Option<&str>, path_only: bool) {
    let manager = match WorktreeManager::discover() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    let worktree = if let Some(name) = name {
        if name.trim().is_empty() {
            pick_or_error(&manager)
        } else {
            match manager.find_worktree_by_name(name) {
                Ok(Some(wt)) => wt,
                Ok(None) => {
                    eprintln!(
                        "{} Worktree '{}' not found. Use 'grove list' to see available worktrees.",
                        "Error:".red(),
                        name
                    );
                    std::process::exit(1);
                }
                Err(e) => {
                    eprintln!("{} {}", "Error:".red(), e);
                    std::process::exit(1);
                }
            }
        }
    } else {
        pick_or_error(&manager)
    };

    navigate_to_worktree(&worktree, path_only);
}

fn pick_or_error(manager: &WorktreeManager) -> Worktree {
    let worktrees = match manager.list_worktrees() {
        Ok(wts) => wts,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    if worktrees.is_empty() {
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

    let items: Vec<String> = worktrees
        .iter()
        .map(|wt| format!("{} ({})", wt.branch, wt.path))
        .collect();

    let selection: Result<Option<usize>, _> = dialoguer::FuzzySelect::new()
        .with_prompt("Select a worktree (type to search)")
        .items(&items)
        .interact_opt();

    match selection {
        Ok(Some(idx)) => worktrees[idx].clone(),
        _ => {
            println!("{}", "Selection cancelled.".dimmed());
            std::process::exit(0);
        }
    }
}

fn navigate_to_worktree(worktree: &Worktree, path_only: bool) {
    if path_only {
        println!("{}", worktree.path);
        return;
    }

    let shell = get_shell_for_platform();

    println!(
        "{} {}",
        "✓ Entering worktree:".green(),
        worktree.branch.bold()
    );
    println!("  {} {}", "Path:".dimmed(), worktree.path);

    // Show shell integration tip on first use
    if should_show_shell_tip() {
        if let Some(instructions) = get_shell_setup_instructions() {
            println!("{}", instructions);
            mark_shell_tip_shown();
        }
    }

    println!();

    let status = Command::new(&shell)
        .current_dir(&worktree.path)
        .env("GROVE_WORKTREE", &worktree.branch)
        .status();

    match status {
        Ok(s) => {
            if let Some(signal) = s.code() {
                if signal != 0 {
                    println!("{}", "Exited worktree shell.".dimmed());
                }
            } else {
                println!("{}", "Exited worktree shell.".dimmed());
            }
        }
        Err(e) => {
            eprintln!("{} Failed to spawn shell: {}", "Error:".red(), e);
            std::process::exit(1);
        }
    }

    println!("{}", "Exited worktree shell.".dimmed());
}
