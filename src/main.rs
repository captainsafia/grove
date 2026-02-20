use clap::{Parser, Subcommand};
use colored::Colorize;

mod commands;
mod git;
mod models;
mod utils;

const VERSION: &str = env!("CARGO_PKG_VERSION");

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
        pr_number: String,
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
        #[arg(long = "older-than")]
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
        version: Option<String>,
        /// Update to a specific PR build
        #[arg(long)]
        pr: Option<String>,
    },
    /// Output shell integration function for grove go
    ShellInit {
        /// Shell type: bash, zsh, fish, pwsh, or powershell
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
                    eprintln!("{} Invalid command. Use --help for usage information.", "Error:".red());
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
            commands::pr::run(&pr_number);
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
            commands::self_update::run(version.as_deref(), pr.as_deref());
        }
        Some(Commands::ShellInit { shell }) => {
            commands::shell_init::run(&shell);
        }
        Some(Commands::Sync { branch }) => {
            commands::sync::run(branch.as_deref());
        }
        None => {
            // No command provided - show help
            eprintln!("{} No command provided. Use --help for usage information.", "Error:".red());
            std::process::exit(1);
        }
    }
}
