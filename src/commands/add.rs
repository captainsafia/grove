use colored::Colorize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::git::{add_worktree, discover_repo, project_root};
use crate::utils::{read_repo_config, BootstrapCommand};

#[derive(Debug)]
struct BootstrapSummary {
    total: usize,
    succeeded: usize,
    failed: Vec<(String, String)>,
}

pub fn run(name: &str, track: Option<&str>) {
    let repo = match discover_repo() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    let project_root = project_root(&repo);
    let worktree_path = match get_worktree_path(name, project_root) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    let worktree_path_str = worktree_path.to_string_lossy().to_string();

    // Try to create worktree for existing branch first, fall back to creating new branch
    let mut is_new_branch = false;
    if let Err(_existing_err) = add_worktree(&repo, &worktree_path_str, name, false, track) {
        match add_worktree(&repo, &worktree_path_str, name, true, track) {
            Ok(()) => is_new_branch = true,
            Err(new_err) => {
                eprintln!(
                    "{} Failed to create worktree for '{}':\n  As existing branch: {}\n  As new branch: {}",
                    "Error:".red(),
                    name,
                    _existing_err,
                    new_err
                );
                std::process::exit(1);
            }
        }
    }

    if is_new_branch {
        println!(
            "{} {}",
            "✓ Created new branch and worktree:".green(),
            name.bold()
        );
    } else {
        println!("{} {}", "✓ Created worktree:".green(), name.bold());
    }
    println!("  {}", format!("Path: {}", worktree_path_str).dimmed());

    let repo_config = match read_repo_config(project_root) {
        Ok(config) => config,
        Err(e) => {
            eprintln!("{} {}", "Warning:".yellow(), e);
            return;
        }
    };

    let commands = match repo_config.bootstrap {
        Some(bootstrap) if !bootstrap.commands.is_empty() => bootstrap.commands,
        _ => return,
    };

    println!("{}", "Running bootstrap commands...".blue());
    let summary = run_bootstrap_commands(&worktree_path, &commands);
    if summary.failed.is_empty() {
        println!(
            "{} {}",
            "✓ Bootstrap completed:".green(),
            format!("{}/{} succeeded", summary.succeeded, summary.total).bold()
        );
    } else {
        eprintln!(
            "{} {}",
            "Warning:".yellow(),
            format!(
                "Bootstrap completed in partial state: {}/{} succeeded.",
                summary.succeeded, summary.total
            )
            .yellow()
        );
        for (command, reason) in &summary.failed {
            eprintln!("  - {} ({})", command.bold(), reason);
        }
        eprintln!(
            "  {}",
            format!(
                "Review and rerun failed commands in {}",
                worktree_path.to_string_lossy()
            )
            .dimmed()
        );
    }
}

pub fn get_worktree_path(branch_name: &str, project_root: &Path) -> Result<PathBuf, String> {
    // Validate branch name doesn't contain path traversal
    if branch_name.contains("..") || Path::new(branch_name).is_absolute() {
        return Err("Invalid branch name: contains path traversal characters".to_string());
    }

    if branch_name
        .chars()
        .any(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
    {
        return Err(
            "Invalid branch name: contains prohibited characters (< > : \" | ? *)".to_string(),
        );
    }

    let worktree_path = project_root.join(branch_name);

    // Ensure the resolved path is within the project root
    let resolved_path = worktree_path.canonicalize().unwrap_or_else(|_| {
        std::fs::canonicalize(project_root)
            .unwrap_or_else(|_| project_root.to_path_buf())
            .join(branch_name)
    });

    let resolved_root = project_root
        .canonicalize()
        .unwrap_or_else(|_| project_root.to_path_buf());

    if !resolved_path.starts_with(&resolved_root) {
        return Err("Invalid branch name: would create worktree outside project".to_string());
    }

    Ok(resolved_path)
}

fn run_bootstrap_commands(worktree_path: &Path, commands: &[BootstrapCommand]) -> BootstrapSummary {
    let mut succeeded = 0;
    let mut failed = Vec::new();

    for (idx, command) in commands.iter().enumerate() {
        let command_display = format_bootstrap_command(command);
        println!(
            "{}",
            format!(
                "[bootstrap {}/{}] {}",
                idx + 1,
                commands.len(),
                command_display
            )
            .dimmed()
        );

        if command.program.trim().is_empty() {
            failed.push((
                command_display,
                "invalid command (empty program)".to_string(),
            ));
            continue;
        }

        let result = Command::new(&command.program)
            .args(&command.args)
            .current_dir(worktree_path)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status();

        match result {
            Ok(status) if status.success() => {
                succeeded += 1;
            }
            Ok(status) => {
                let reason = match status.code() {
                    Some(code) => format!("exit code {}", code),
                    None => "terminated by signal".to_string(),
                };
                failed.push((command_display, reason));
            }
            Err(e) => {
                failed.push((command_display, format!("failed to execute: {}", e)));
            }
        }
    }

    BootstrapSummary {
        total: commands.len(),
        succeeded,
        failed,
    }
}

fn format_bootstrap_command(command: &BootstrapCommand) -> String {
    if command.args.is_empty() {
        command.program.clone()
    } else {
        format!("{} {}", command.program, command.args.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::make_temp_dir;
    use regex::Regex;
    use std::env;
    use std::fs;

    // --- getWorktreePath security tests ---

    #[test]
    fn reject_branch_names_with_double_dots() {
        let project_root = env::current_dir().unwrap();
        assert!(get_worktree_path("../malicious", &project_root).is_err());
    }

    #[test]
    fn reject_embedded_double_dots() {
        let project_root = env::current_dir().unwrap();
        assert!(get_worktree_path("feature/../../../etc/passwd", &project_root).is_err());
    }

    #[test]
    fn reject_absolute_paths() {
        let project_root = env::current_dir().unwrap();
        assert!(get_worktree_path("/etc/passwd", &project_root).is_err());
    }

    #[test]
    fn reject_angle_brackets() {
        let project_root = env::current_dir().unwrap();
        assert!(get_worktree_path("feature<test>", &project_root).is_err());
        assert!(get_worktree_path("feature>test", &project_root).is_err());
    }

    #[test]
    fn reject_colon() {
        let project_root = env::current_dir().unwrap();
        assert!(get_worktree_path("feature:test", &project_root).is_err());
    }

    #[test]
    fn reject_quotes() {
        let project_root = env::current_dir().unwrap();
        assert!(get_worktree_path("feature\"test", &project_root).is_err());
    }

    #[test]
    fn reject_pipe() {
        let project_root = env::current_dir().unwrap();
        assert!(get_worktree_path("feature|test", &project_root).is_err());
    }

    #[test]
    fn reject_question_mark() {
        let project_root = env::current_dir().unwrap();
        assert!(get_worktree_path("feature?test", &project_root).is_err());
    }

    #[test]
    fn reject_asterisk() {
        let project_root = env::current_dir().unwrap();
        assert!(get_worktree_path("feature*test", &project_root).is_err());
    }

    #[test]
    fn accept_simple_branch_names() {
        let project_root = env::current_dir().unwrap();
        let result = get_worktree_path("feature-branch", &project_root).unwrap();
        assert!(result.to_string_lossy().contains("feature-branch"));
    }

    #[test]
    fn accept_nested_branch_names() {
        let project_root = env::current_dir().unwrap();
        let result = get_worktree_path("feature/my-feature", &project_root);
        assert!(result.is_ok());
    }

    #[test]
    fn accept_branch_with_numbers() {
        let project_root = env::current_dir().unwrap();
        let result = get_worktree_path("feature-123", &project_root);
        assert!(result.is_ok());
    }

    #[test]
    fn bootstrap_no_commands_is_noop() {
        let worktree_dir = make_temp_dir("bootstrap-empty");
        let summary = run_bootstrap_commands(&worktree_dir, &[]);
        assert_eq!(summary.total, 0);
        assert_eq!(summary.succeeded, 0);
        assert_eq!(summary.failed.len(), 0);
        let _ = fs::remove_dir_all(worktree_dir);
    }

    #[test]
    fn bootstrap_continues_after_failure() {
        let worktree_dir = make_temp_dir("bootstrap-continue");
        let commands = vec![
            BootstrapCommand {
                program: "git".to_string(),
                args: vec!["--version".to_string()],
            },
            BootstrapCommand {
                program: "git".to_string(),
                args: vec!["--definitely-invalid-flag".to_string()],
            },
            BootstrapCommand {
                program: "git".to_string(),
                args: vec!["--version".to_string()],
            },
        ];

        let summary = run_bootstrap_commands(&worktree_dir, &commands);
        assert_eq!(summary.total, 3);
        assert_eq!(summary.succeeded, 2);
        assert_eq!(summary.failed.len(), 1);
        assert!(summary.failed[0]
            .0
            .contains("git --definitely-invalid-flag"));
        let _ = fs::remove_dir_all(worktree_dir);
    }

    #[test]
    fn bootstrap_marks_empty_program_as_failed() {
        let worktree_dir = make_temp_dir("bootstrap-empty-program");
        let commands = vec![BootstrapCommand {
            program: "".to_string(),
            args: vec!["--version".to_string()],
        }];

        let summary = run_bootstrap_commands(&worktree_dir, &commands);
        assert_eq!(summary.total, 1);
        assert_eq!(summary.succeeded, 0);
        assert_eq!(summary.failed.len(), 1);
        assert!(summary.failed[0].1.contains("invalid command"));
        let _ = fs::remove_dir_all(worktree_dir);
    }

    // --- self-update validation tests (ported from cli.test.ts) ---

    #[test]
    fn pr_number_validation_valid() {
        let re = Regex::new(r"^\d+$").unwrap();
        assert!(re.is_match("123"));
        assert!(re.is_match("1"));
        assert!(re.is_match("99999"));
    }

    #[test]
    fn pr_number_validation_command_injection() {
        let re = Regex::new(r"^\d+$").unwrap();
        assert!(!re.is_match("123; rm -rf /"));
        assert!(!re.is_match("123 && malicious"));
        assert!(!re.is_match("$(whoami)"));
        assert!(!re.is_match("`whoami`"));
    }

    #[test]
    fn pr_number_validation_non_numeric() {
        let re = Regex::new(r"^\d+$").unwrap();
        assert!(!re.is_match("abc"));
        assert!(!re.is_match("12a3"));
        assert!(!re.is_match("-123"));
        assert!(!re.is_match("12.3"));
    }

    #[test]
    fn version_format_valid() {
        let re = Regex::new(r"^v?\d+\.\d+\.\d+(-[\w.]+)?$").unwrap();
        assert!(re.is_match("1.0.0"));
        assert!(re.is_match("v1.0.0"));
        assert!(re.is_match("2.10.3"));
        assert!(re.is_match("v0.0.1"));
    }

    #[test]
    fn version_format_prerelease() {
        let re = Regex::new(r"^v?\d+\.\d+\.\d+(-[\w.]+)?$").unwrap();
        assert!(re.is_match("1.0.0-alpha"));
        assert!(re.is_match("v1.0.0-beta.1"));
        assert!(re.is_match("1.0.0-rc.2"));
    }

    #[test]
    fn version_format_command_injection() {
        let re = Regex::new(r"^v?\d+\.\d+\.\d+(-[\w.]+)?$").unwrap();
        assert!(!re.is_match("1.0.0; rm -rf /"));
        assert!(!re.is_match("1.0.0 && malicious"));
        assert!(!re.is_match("$(whoami)"));
    }

    #[test]
    fn version_format_invalid() {
        let re = Regex::new(r"^v?\d+\.\d+\.\d+(-[\w.]+)?$").unwrap();
        assert!(!re.is_match("1.0"));
        assert!(!re.is_match("1"));
        assert!(!re.is_match("latest"));
    }
}
