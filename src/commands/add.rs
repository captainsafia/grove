use colored::Colorize;
use std::path::{Path, PathBuf};

use crate::git::{add_worktree, discover_repo, project_root};

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
}

pub fn get_worktree_path(branch_name: &str, project_root: &Path) -> Result<PathBuf, String> {
    // Validate branch name doesn't contain path traversal
    if branch_name.contains("..") || Path::new(branch_name).is_absolute() {
        return Err("Invalid branch name: contains path traversal characters".to_string());
    }

    // Sanitize special characters
    let sanitized_name = branch_name.replace(['<', '>', ':', '"', '|', '?', '*'], "-");

    let worktree_path = project_root.join(&sanitized_name);

    // Ensure the resolved path is within the project root
    let resolved_path = worktree_path.canonicalize().unwrap_or_else(|_| {
        std::fs::canonicalize(project_root)
            .unwrap_or_else(|_| project_root.to_path_buf())
            .join(&sanitized_name)
    });

    let resolved_root = project_root
        .canonicalize()
        .unwrap_or_else(|_| project_root.to_path_buf());

    if !resolved_path.starts_with(&resolved_root) {
        return Err("Invalid branch name: would create worktree outside project".to_string());
    }

    Ok(resolved_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use regex::Regex;
    use std::env;

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
    fn sanitize_angle_brackets() {
        let project_root = env::current_dir().unwrap();
        let result = get_worktree_path("feature<test>", &project_root).unwrap();
        let basename = result.file_name().unwrap().to_str().unwrap();
        assert!(!basename.contains('<'));
        assert!(!basename.contains('>'));
    }

    #[test]
    fn sanitize_colon() {
        let project_root = env::current_dir().unwrap();
        let result = get_worktree_path("feature:test", &project_root).unwrap();
        let basename = result.file_name().unwrap().to_str().unwrap();
        assert!(!basename.contains(':'));
    }

    #[test]
    fn sanitize_quotes() {
        let project_root = env::current_dir().unwrap();
        let result = get_worktree_path("feature\"test", &project_root).unwrap();
        let basename = result.file_name().unwrap().to_str().unwrap();
        assert!(!basename.contains('"'));
    }

    #[test]
    fn sanitize_pipe() {
        let project_root = env::current_dir().unwrap();
        let result = get_worktree_path("feature|test", &project_root).unwrap();
        let basename = result.file_name().unwrap().to_str().unwrap();
        assert!(!basename.contains('|'));
    }

    #[test]
    fn sanitize_question_mark() {
        let project_root = env::current_dir().unwrap();
        let result = get_worktree_path("feature?test", &project_root).unwrap();
        let basename = result.file_name().unwrap().to_str().unwrap();
        assert!(!basename.contains('?'));
    }

    #[test]
    fn sanitize_asterisk() {
        let project_root = env::current_dir().unwrap();
        let result = get_worktree_path("feature*test", &project_root).unwrap();
        let basename = result.file_name().unwrap().to_str().unwrap();
        assert!(!basename.contains('*'));
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
