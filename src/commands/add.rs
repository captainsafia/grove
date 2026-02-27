use colored::Colorize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::git::{add_worktree, branch_exists, discover_repo, project_root, RepoContext};
use crate::utils::{read_repo_config, BootstrapCommand};

#[derive(Debug)]
struct BootstrapSummary {
    total: usize,
    succeeded: usize,
    failed: Vec<(String, String)>,
}

const DEFAULT_NAME_ATTEMPTS: u64 = 64;
const DEFAULT_ADJECTIVES: &[&str] = &[
    "amber", "autumn", "brisk", "calm", "cedar", "clear", "cobalt", "cosmic", "dawn", "deep",
    "eager", "ember", "gentle", "golden", "granite", "green", "hidden", "hollow", "icy", "jolly",
    "keen", "lively", "lunar", "mellow", "misty", "modern", "morning", "nimble", "noble", "quiet",
    "rapid", "rustic", "silver", "steady", "swift", "tidy", "urban", "vivid", "warm", "wild",
];
const DEFAULT_NOUNS: &[&str] = &[
    "brook",
    "canopy",
    "canyon",
    "cliff",
    "cloud",
    "creek",
    "dawn",
    "delta",
    "field",
    "forest",
    "garden",
    "grove",
    "harbor",
    "horizon",
    "island",
    "lake",
    "leaf",
    "meadow",
    "mesa",
    "moonlight",
    "mountain",
    "orchard",
    "peak",
    "pine",
    "planet",
    "prairie",
    "quartz",
    "rain",
    "ridge",
    "river",
    "shadow",
    "shore",
    "sky",
    "spring",
    "stone",
    "summit",
    "thunder",
    "trail",
    "valley",
    "willow",
];

pub fn run(name: Option<&str>, track: Option<&str>) {
    let repo = match discover_repo() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    let project_root = project_root(&repo);
    let (branch_name, generated_name) = match resolve_worktree_name(name, &repo, project_root) {
        Ok(name) => name,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };
    let worktree_path = match get_worktree_path(&branch_name, project_root) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    };

    let worktree_path_str = worktree_path.to_string_lossy().to_string();

    // Try to create worktree for existing branch first, fall back to creating new branch
    let mut is_new_branch = false;
    if let Err(existing_err) = add_worktree(&repo, &worktree_path_str, &branch_name, false, track) {
        match add_worktree(&repo, &worktree_path_str, &branch_name, true, track) {
            Ok(()) => is_new_branch = true,
            Err(new_err) => {
                eprintln!(
                    "{} Failed to create worktree for '{}':\n  As existing branch: {}\n  As new branch: {}",
                    "Error:".red(),
                    branch_name,
                    existing_err,
                    new_err
                );
                std::process::exit(1);
            }
        }
    }

    if generated_name {
        println!(
            "{} {}",
            "✓ Generated worktree name:".green(),
            branch_name.bold()
        );
    }

    if is_new_branch {
        println!(
            "{} {}",
            "✓ Created new branch and worktree:".green(),
            branch_name.bold()
        );
    } else {
        println!("{} {}", "✓ Created worktree:".green(), branch_name.bold());
    }
    println!("{}", format!("Path: {}", worktree_path_str).dimmed());

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

fn resolve_worktree_name(
    provided_name: Option<&str>,
    repo: &RepoContext,
    project_root: &Path,
) -> Result<(String, bool), String> {
    if let Some(name) = provided_name {
        return Ok((name.to_string(), false));
    }

    let generated = choose_default_worktree_name(repo, project_root)?;
    Ok((generated, true))
}

fn choose_default_worktree_name(repo: &RepoContext, project_root: &Path) -> Result<String, String> {
    let seed = default_name_seed();
    for attempt in 0..DEFAULT_NAME_ATTEMPTS {
        let candidate = generate_default_worktree_name_with_seed(seed, attempt);
        if is_name_available(repo, project_root, &candidate) {
            return Ok(candidate);
        }
    }

    Err(
        "Unable to generate a unique default worktree name; please provide one explicitly."
            .to_string(),
    )
}

fn is_name_available(repo: &RepoContext, project_root: &Path, candidate: &str) -> bool {
    if branch_exists(repo, candidate) {
        return false;
    }

    !project_root.join(candidate).exists()
}

fn default_name_seed() -> u64 {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let nanos = duration.as_nanos() as u64;
    nanos ^ ((std::process::id() as u64) << 32)
}

fn generate_default_worktree_name_with_seed(seed: u64, attempt: u64) -> String {
    let adjective_index =
        (splitmix64(seed.wrapping_add(attempt)) % DEFAULT_ADJECTIVES.len() as u64) as usize;
    let noun_seed = seed.wrapping_add(attempt.wrapping_mul(0x9E37_79B9_7F4A_7C15));
    let noun_index = (splitmix64(noun_seed) % DEFAULT_NOUNS.len() as u64) as usize;

    format!(
        "{}-{}",
        DEFAULT_ADJECTIVES[adjective_index], DEFAULT_NOUNS[noun_index]
    )
}

fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9E37_79B9_7F4A_7C15);
    value = (value ^ (value >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    value ^ (value >> 31)
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
    fn generated_default_name_uses_adjective_noun_format() {
        let generated = generate_default_worktree_name_with_seed(42, 0);
        let parts: Vec<&str> = generated.split('-').collect();
        assert_eq!(parts.len(), 2);
        assert!(DEFAULT_ADJECTIVES.contains(&parts[0]));
        assert!(DEFAULT_NOUNS.contains(&parts[1]));
    }

    #[test]
    fn generated_default_name_variation_across_attempts() {
        let name_a = generate_default_worktree_name_with_seed(42, 0);
        let name_b = generate_default_worktree_name_with_seed(42, 1);
        assert_ne!(name_a, name_b);
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
