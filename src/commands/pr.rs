use colored::Colorize;
use std::process::Command;

use crate::git::WorktreeManager;

pub fn run(pr_number: &str) {
    let pr_num: u64 = match pr_number.parse() {
        Ok(n) if n > 0 => n,
        _ => {
            eprintln!("{} Invalid PR number: {}", "Error:".red(), pr_number);
            std::process::exit(1);
        }
    };

    // Check gh CLI is available
    if Command::new("gh").arg("--version").output().is_err() {
        eprintln!(
            "{} gh CLI is not installed. Please install it from https://cli.github.com/",
            "Error:".red()
        );
        std::process::exit(1);
    }

    let manager = match WorktreeManager::discover() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    let bare_repo_path = manager.get_repo_path().to_path_buf();
    let project_root = manager.get_project_root();

    println!("{}", format!("Fetching PR #{} information...", pr_num).dimmed());

    // Get PR info via gh CLI
    let output = Command::new("gh")
        .args(["pr", "view", &pr_num.to_string(), "--json", "headRefName,headRepository"])
        .current_dir(&bare_repo_path)
        .output();

    let pr_info: serde_json::Value = match output {
        Ok(o) if o.status.success() => {
            serde_json::from_slice(&o.stdout).unwrap_or_else(|_| {
                eprintln!(
                    "{} Failed to parse PR #{} info.",
                    "Error:".red(),
                    pr_num
                );
                std::process::exit(1);
            })
        }
        _ => {
            eprintln!(
                "{} Failed to fetch PR #{}. Make sure the PR exists and you have access to the repository.",
                "Error:".red(),
                pr_num
            );
            std::process::exit(1);
        }
    };

    let branch_name = pr_info["headRefName"]
        .as_str()
        .unwrap_or("")
        .to_string();

    if branch_name.is_empty() {
        eprintln!(
            "{} Could not determine branch name for PR #{}",
            "Error:".red(),
            pr_num
        );
        std::process::exit(1);
    }

    let cleaned: String = branch_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>()
        .replace("--", "-")
        .trim_matches('-')
        .to_string();

    let worktree_name = format!("pr-{}-{}", pr_num, cleaned);
    let worktree_path = project_root.join(&worktree_name);
    let worktree_path_str = worktree_path.to_string_lossy().to_string();

    // Check if worktree already exists
    if let Ok(Some(_)) = manager.find_worktree_by_name(&worktree_name) {
        println!(
            "{} {}",
            "⚠ Worktree already exists:".yellow(),
            worktree_path_str.bold()
        );
        return;
    }

    // Fetch PR branch
    println!("{}", format!("Fetching PR branch: {}...", branch_name).dimmed());
    let fetch = Command::new("git")
        .args(["fetch", "origin", &format!("pull/{}/head:pr-{}", pr_num, pr_num)])
        .current_dir(&bare_repo_path)
        .output();

    if let Err(e) = fetch {
        eprintln!("{} Failed to fetch PR #{}: {}", "Error:".red(), pr_num, e);
        std::process::exit(1);
    }

    // Create worktree
    println!("{}", format!("Creating worktree: {}...", worktree_name).dimmed());
    if let Err(e) = manager.add_worktree(
        &worktree_path_str,
        &format!("pr-{}", pr_num),
        false,
        None,
    ) {
        eprintln!("{} {}", "Error:".red(), e);
        std::process::exit(1);
    }

    println!(
        "{} {}",
        "✓ Created worktree for PR".green(),
        format!("#{}", pr_num).bold()
    );
    println!("  {} {}", "Branch:".dimmed(), branch_name.bold());
    println!("  {} {}", "Path:".dimmed(), worktree_path_str.bold());
    println!();
    println!("{}", "To switch to this worktree, run:".dimmed());
    println!("  {}", format!("grove go {}", worktree_name).cyan());
}
