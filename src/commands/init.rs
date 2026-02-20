use colored::Colorize;
use std::fs;
use std::path::Path;

use crate::git::WorktreeManager;
use crate::utils::{extract_repo_name, find_grove_repo, is_valid_git_url};

pub fn run(git_url: &str) {
    // Check if we're inside an existing grove repository
    if let Some(existing) = find_grove_repo(None) {
        eprintln!(
            "{} Cannot initialize grove inside an existing grove repository.\nDetected grove repository at: {}\n\nTo create a new grove setup, run 'grove init' from outside this directory hierarchy.",
            "Error:".red(),
            existing.display()
        );
        std::process::exit(1);
    }

    // Validate git URL format
    if !is_valid_git_url(git_url) {
        eprintln!(
            "{} Invalid git URL format. Supported formats:\n  - HTTPS: https://github.com/user/repo.git\n  - SSH: git@github.com:user/repo.git\n  - SSH: ssh://git@github.com/user/repo.git",
            "Error:".red()
        );
        std::process::exit(1);
    }

    // Extract repository name from URL
    let repo_name = match extract_repo_name(git_url) {
        Ok(name) => name,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    // Track if we created the directory
    let mut created_dir = false;

    // Create directory with repo name
    if !Path::new(&repo_name).exists() {
        if let Err(e) = fs::create_dir_all(&repo_name) {
            eprintln!("{} Failed to create directory: {}", "Error:".red(), e);
            std::process::exit(1);
        }
        created_dir = true;
    }

    // Define bare repo directory
    let bare_repo_dir = format!("{}/{}.git", repo_name, repo_name);

    // Check if directory already exists
    if Path::new(&bare_repo_dir).exists() {
        eprintln!("{} Directory {} already exists", "Error:".red(), bare_repo_dir);
        std::process::exit(1);
    }

    let manager = WorktreeManager::new(None);
    if let Err(e) = manager.clone_bare_repository(git_url, &bare_repo_dir) {
        // Clean up on failure
        if created_dir {
            let _ = fs::remove_dir_all(&repo_name);
        }
        eprintln!("{} {}", "Error:".red(), e);
        std::process::exit(1);
    }

    println!(
        "{} {}",
        "✓ Initialized worktree setup:".green(),
        repo_name.bold()
    );
    println!("  {} {}", "Bare repository:".dimmed(), bare_repo_dir);
    println!();
    println!("{}", "Next steps:".bold());
    println!("  {} {}", "cd".dimmed(), bare_repo_dir);
    println!("  {} {}", "grove add".dimmed(), "<branch-name>");
}
