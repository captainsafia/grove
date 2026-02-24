use clap::{Parser, Subcommand};
use colored::Colorize;
use regex::Regex;
use std::path::Path;

mod commands;
mod git;
mod models;
mod utils;

use crate::utils::{is_valid_git_url, parse_duration, trim_trailing_branch_slashes};

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn validate_branch_name(value: &str) -> Result<String, String> {
    let trimmed = trim_trailing_branch_slashes(value);
    if trimmed.is_empty() {
        return Err("Branch name is required".to_string());
    }
    if trimmed.contains("..") || Path::new(trimmed).is_absolute() {
        return Err("Invalid branch name: contains path traversal characters".to_string());
    }
    if trimmed
        .chars()
        .any(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
    {
        return Err(
            "Invalid branch name: contains prohibited characters (< > : \" | ? *)".to_string(),
        );
    }
    Ok(trimmed.to_string())
}

fn validate_git_url(value: &str) -> Result<String, String> {
    if is_valid_git_url(value) {
        Ok(value.to_string())
    } else {
        Err("Invalid git URL format. Supported formats:\n  - HTTPS: https://github.com/user/repo.git\n  - SSH: git@github.com:user/repo.git\n  - SSH: ssh://git@github.com/user/repo.git".to_string())
    }
}

fn validate_pr_number(value: &str) -> Result<u64, String> {
    let parsed: u64 = value
        .parse()
        .map_err(|_| format!("Invalid PR number: {}", value))?;
    if parsed == 0 {
        return Err("Invalid PR number: must be a positive integer".to_string());
    }
    Ok(parsed)
}

fn validate_version(value: &str) -> Result<String, String> {
    let re = Regex::new(r"^v?\d+\.\d+\.\d+(-[\w.]+)?$").unwrap();
    if re.is_match(value) {
        Ok(value.to_string())
    } else {
        Err("Invalid version format: must be semver (e.g., v1.0.0 or 1.0.0)".to_string())
    }
}

fn validate_duration(value: &str) -> Result<String, String> {
    parse_duration(value).map(|_| value.to_string())
}

#[derive(Parser)]
#[command(name = "grove", about = "Grove is a Git worktree management tool", version = VERSION)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a new worktree
    Add {
        /// Branch name (creates new branch if it doesn't exist)
        #[arg(value_parser = validate_branch_name)]
        name: String,
        /// Set up tracking for the specified remote branch
        #[arg(short = 't', long = "track")]
        track: Option<String>,
    },
    /// Navigate to a worktree by branch name
    Go {
        /// Branch name or worktree name to navigate to (optional)
        name: Option<String>,
        /// Output path only (used by shell integration)
        #[arg(short = 'p', long = "path-only")]
        path_only: bool,
    },
    /// Initialize a new worktree setup
    Init {
        /// Git repository URL to clone
        #[arg(value_parser = validate_git_url)]
        git_url: String,
    },
    /// List all worktrees
    #[command(alias = "ls")]
    List {
        /// Show detailed information
        #[arg(long)]
        details: bool,
        /// Show only dirty worktrees
        #[arg(long)]
        dirty: bool,
        /// Show only locked worktrees
        #[arg(long)]
        locked: bool,
        /// Output in JSON format
        #[arg(long)]
        json: bool,
    },
    /// Checkout a GitHub pull request into a new worktree
    Pr {
        /// Pull request number
        #[arg(value_parser = validate_pr_number)]
        pr_number: u64,
    },
    /// Remove worktrees for merged branches
    Prune {
        /// Show what would be removed without actually removing
        #[arg(long)]
        dry_run: bool,
        /// Skip confirmation and remove worktrees even with uncommitted changes
        #[arg(short = 'f', long)]
        force: bool,
        /// Base branch to check for merged branches
        #[arg(long)]
        base: Option<String>,
        /// Prune worktrees older than specified duration (e.g., 30d, 2w, 6M, 1y)
        #[arg(long = "older-than", value_parser = validate_duration)]
        older_than: Option<String>,
    },
    /// Remove a worktree
    #[command(alias = "rm")]
    Remove {
        /// Branch name or path of the worktree to remove (optional)
        name: Option<String>,
        /// Remove the worktree even if it has uncommitted changes
        #[arg(long)]
        force: bool,
        /// Skip confirmation prompt
        #[arg(short = 'y', long)]
        yes: bool,
    },
    /// Update grove to a specific version or PR
    SelfUpdate {
        /// Version to update to (e.g., v1.0.0 or 1.0.0). Defaults to latest.
        #[arg(value_parser = validate_version)]
        version: Option<String>,
        /// Update to a specific PR build
        #[arg(long, value_parser = validate_pr_number, conflicts_with = "version")]
        pr: Option<u64>,
    },
    /// Output shell integration function for grove go
    ShellInit {
        /// Shell type: bash, zsh, fish, pwsh, or powershell
        #[arg(value_parser = ["bash", "zsh", "fish", "pwsh", "powershell"])]
        shell: String,
    },
    /// Sync the bare clone with the latest changes from origin
    Sync {
        /// Branch to sync (defaults to main or master)
        #[arg(short = 'b', long = "branch")]
        branch: Option<String>,
    },
}

fn main() {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(e) => {
            match e.kind() {
                clap::error::ErrorKind::InvalidSubcommand => {
                    eprintln!(
                        "{} Invalid command. Use --help for usage information.",
                        "Error:".red()
                    );
                    std::process::exit(1);
                }
                clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion => {
                    // Let clap handle --help and --version normally
                    e.exit();
                }
                _ => {
                    e.exit();
                }
            }
        }
    };

    match cli.command {
        Some(Commands::Add { name, track }) => {
            commands::add::run(&name, track.as_deref());
        }
        Some(Commands::Go { name, path_only }) => {
            commands::go::run(name.as_deref(), path_only);
        }
        Some(Commands::Init { git_url }) => {
            commands::init::run(&git_url);
        }
        Some(Commands::List {
            details,
            dirty,
            locked,
            json,
        }) => {
            commands::list::run(details, dirty, locked, json);
        }
        Some(Commands::Pr { pr_number }) => {
            commands::pr::run(pr_number);
        }
        Some(Commands::Prune {
            dry_run,
            force,
            base,
            older_than,
        }) => {
            commands::prune::run(dry_run, force, base.as_deref(), older_than.as_deref());
        }
        Some(Commands::Remove { name, force, yes }) => {
            commands::remove::run(name.as_deref(), force, yes);
        }
        Some(Commands::SelfUpdate { version, pr }) => {
            commands::self_update::run(version.as_deref(), pr);
        }
        Some(Commands::ShellInit { shell }) => {
            commands::shell_init::run(&shell);
        }
        Some(Commands::Sync { branch }) => {
            commands::sync::run(branch.as_deref());
        }
        None => {
            // No command provided - show help
            eprintln!(
                "{} No command provided. Use --help for usage information.",
                "Error:".red()
            );
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::validate_branch_name;

    #[test]
    fn validate_branch_name_trims_trailing_slashes() {
        assert_eq!(
            validate_branch_name("feature/my-branch///").unwrap(),
            "feature/my-branch"
        );
    }

    #[test]
    fn validate_branch_name_rejects_empty_after_trimming() {
        assert!(validate_branch_name("///").is_err());
    }
}
