use chrono::{DateTime, Utc};
use colored::Colorize;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

// ============================================================================
// Error Handling
// ============================================================================

/// Standard error handler for CLI commands.
/// Formats and displays the error, then exits with code 1.
#[allow(dead_code)]
pub fn handle_command_error(error: &str) -> ! {
    eprintln!("{} {}", "Error:".red(), error);
    std::process::exit(1);
}

// ============================================================================
// Configuration
// ============================================================================

/// Get the path to the grove config directory (~/.config/grove).
pub fn get_config_dir() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        home.join(".config").join("grove")
    } else {
        PathBuf::from(".config").join("grove")
    }
}

/// Get the path to the grove config file (~/.config/grove/config.json).
pub fn get_config_path() -> PathBuf {
    get_config_dir().join("config.json")
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct GroveConfig {
    #[serde(rename = "shellTipShown", skip_serializing_if = "Option::is_none")]
    pub shell_tip_shown: Option<bool>,
}

/// Read the grove config file.
pub fn read_config() -> GroveConfig {
    let path = get_config_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => GroveConfig::default(),
    }
}

/// Write to the grove config file.
pub fn write_config(config: &GroveConfig) {
    let config_dir = get_config_dir();
    let _ = fs::create_dir_all(&config_dir);
    if let Ok(content) = serde_json::to_string_pretty(config) {
        let _ = fs::write(get_config_path(), content);
    }
}

// ============================================================================
// Duration Parsing
// ============================================================================

// Duration constants in milliseconds
const MS_PER_SECOND: u64 = 1000;
const MS_PER_MINUTE: u64 = 60 * MS_PER_SECOND;
const MS_PER_HOUR: u64 = 60 * MS_PER_MINUTE;
const MS_PER_DAY: u64 = 24 * MS_PER_HOUR;
const MS_PER_WEEK: u64 = 7 * MS_PER_DAY;
const MS_PER_MONTH: u64 = 30 * MS_PER_DAY;
const MS_PER_YEAR: u64 = 365 * MS_PER_DAY;

pub fn is_valid_git_url(url: &str) -> bool {
    if url.is_empty() {
        return false;
    }

    let patterns = [
        r"^https?://.+/.+$",
        r"^git@[^:]+:.+$",
        r"^ssh://.+/.+$",
    ];

    patterns.iter().any(|p| {
        Regex::new(p).map(|re| re.is_match(url)).unwrap_or(false)
    })
}

pub fn extract_repo_name(git_url: &str) -> Result<String, String> {
    // Remove .git suffix if present
    let clean_url = git_url.strip_suffix(".git").unwrap_or(git_url);

    // Handle SSH URLs (git@...)
    if clean_url.starts_with("git@") {
        let parts: Vec<&str> = clean_url.split(':').collect();
        if parts.len() < 2 {
            return Err(format!("Invalid SSH URL format: {}", git_url));
        }
        let url_path = parts[parts.len() - 1];
        let repo_name = Path::new(url_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        if repo_name.is_empty() || repo_name == "." || repo_name == ".." {
            return Err(format!(
                "Could not extract valid repository name from: {}",
                git_url
            ));
        }
        return Ok(repo_name.to_string());
    }

    // Handle HTTPS URLs
    if clean_url.starts_with("http://") || clean_url.starts_with("https://") {
        let repo_name = Path::new(clean_url)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        if repo_name.is_empty() || repo_name == "." || repo_name == ".." {
            return Err(format!(
                "Could not extract valid repository name from: {}",
                git_url
            ));
        }
        return Ok(repo_name.to_string());
    }

    // Handle local paths or simple names
    let repo_name = Path::new(clean_url)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if repo_name.is_empty() || repo_name == "." || repo_name == ".." {
        return Err(format!(
            "Could not extract valid repository name from: {}",
            git_url
        ));
    }

    Ok(repo_name.to_string())
}

/// Normalize human-friendly duration strings to ISO 8601 format.
/// Accepts formats like: 30d, 2w, 6M, 1y, 12h, 30m
/// Returns ISO 8601 format: P30D, P2W, P6M, P1Y, PT12H, PT30M
/// Note: Uppercase M = months, lowercase m = minutes
pub fn normalize_duration(duration_str: &str) -> String {
    if duration_str.is_empty() || duration_str.trim().is_empty() {
        return duration_str.to_string();
    }

    let normalized = duration_str.trim();

    // If it already starts with 'P' or 'p', assume it's ISO 8601 format
    if normalized.to_uppercase().starts_with('P') {
        return normalized.to_string();
    }

    // Match patterns like: 30d, 2w, 6M, 1y, 12h, 30m
    let re = Regex::new(r"^(\d+(?:\.\d+)?)\s*([dDwWMmyYhHsS])$").unwrap();
    if let Some(caps) = re.captures(normalized) {
        let value = &caps[1];
        let unit = &caps[2];

        let (iso_unit, is_time_unit) = match unit {
            "d" | "D" => ("D", false),
            "w" | "W" => ("W", false),
            "M" => ("M", false), // Uppercase M = months
            "y" | "Y" => ("Y", false),
            "h" | "H" => ("H", true),
            "m" => ("M", true), // Lowercase m = minutes
            "s" | "S" => ("S", true),
            _ => return normalized.to_string(),
        };

        if is_time_unit {
            format!("PT{}{}", value, iso_unit)
        } else {
            format!("P{}{}", value, iso_unit)
        }
    } else {
        normalized.to_string()
    }
}

/// Parse ISO 8601 duration string to milliseconds.
fn parse_iso8601_duration(iso: &str) -> u64 {
    let upper = iso.to_uppercase();

    if !upper.starts_with('P') {
        return 0;
    }

    let mut total_ms: u64 = 0;
    let remaining = &upper[1..];

    // Split into date and time parts
    let (date_part, time_part) = if let Some(t_index) = remaining.find('T') {
        (&remaining[..t_index], &remaining[t_index + 1..])
    } else {
        (remaining, "")
    };

    // Parse date part: [n]Y[n]M[n]W[n]D
    let date_re = Regex::new(r"(\d+(?:\.\d+)?)(Y|M|W|D)").unwrap();
    for cap in date_re.captures_iter(date_part) {
        let value: f64 = cap[1].parse().unwrap_or(0.0);
        match &cap[2] {
            "Y" => total_ms += (value * MS_PER_YEAR as f64) as u64,
            "M" => total_ms += (value * MS_PER_MONTH as f64) as u64,
            "W" => total_ms += (value * MS_PER_WEEK as f64) as u64,
            "D" => total_ms += (value * MS_PER_DAY as f64) as u64,
            _ => {}
        }
    }

    // Parse time part: [n]H[n]M[n]S
    let time_re = Regex::new(r"(\d+(?:\.\d+)?)(H|M|S)").unwrap();
    for cap in time_re.captures_iter(time_part) {
        let value: f64 = cap[1].parse().unwrap_or(0.0);
        match &cap[2] {
            "H" => total_ms += (value * MS_PER_HOUR as f64) as u64,
            "M" => total_ms += (value * MS_PER_MINUTE as f64) as u64,
            "S" => total_ms += (value * MS_PER_SECOND as f64) as u64,
            _ => {}
        }
    }

    total_ms
}

pub fn parse_duration(duration_str: &str) -> Result<u64, String> {
    if duration_str.is_empty() || duration_str.trim().is_empty() {
        return Err("Duration cannot be empty (use formats like: 30d, 2w, 6M, 1y, 12h, 30m or ISO 8601 like P30D, P1Y, P2W, PT1H)".to_string());
    }

    let normalized = normalize_duration(duration_str);
    let ms = parse_iso8601_duration(&normalized);
    if ms > 0 {
        return Ok(ms);
    }

    Err(format!(
        "Invalid duration format: {} (use formats like: 30d, 2w, 6M, 1y, 12h, 30m or ISO 8601 like P30D, P1Y, P2W, PT1H)",
        duration_str
    ))
}

pub fn format_created_time(date: &DateTime<Utc>) -> String {
    if date.timestamp() == 0 {
        return "unknown".to_string();
    }

    let now = Utc::now();
    let diff = now.signed_duration_since(*date);
    let hours = diff.num_hours();

    if hours < 1 {
        let minutes = diff.num_minutes();
        let unit = if minutes == 1 { "minute" } else { "minutes" };
        format!("{} {} ago", minutes, unit)
    } else if hours < 24 {
        let unit = if hours == 1 { "hour" } else { "hours" };
        format!("{} {} ago", hours, unit)
    } else if hours < 24 * 7 {
        let days = hours / 24;
        let unit = if days == 1 { "day" } else { "days" };
        format!("{} {} ago", days, unit)
    } else if hours < 24 * 30 {
        let weeks = hours / (24 * 7);
        let unit = if weeks == 1 { "week" } else { "weeks" };
        format!("{} {} ago", weeks, unit)
    } else {
        date.format("%Y-%m-%d").to_string()
    }
}

pub fn format_path_with_tilde(file_path: &str) -> String {
    if let Some(home_dir) = dirs::home_dir() {
        let home_str = home_dir.to_string_lossy().to_string();
        if file_path.starts_with(&home_str) {
            // Only replace if the path is exactly homeDir or followed by a path separator
            if file_path == home_str || file_path.as_bytes().get(home_str.len()) == Some(&b'/') {
                return file_path.replacen(&home_str, "~", 1);
            }
        }
    }
    file_path.to_string()
}

// ============================================================================
// Grove Repository Discovery
// ============================================================================

#[derive(Debug)]
pub struct GroveDiscoveryError {
    pub message: String,
    #[allow(dead_code)]
    pub is_regular_git_repo: bool,
}

impl std::fmt::Display for GroveDiscoveryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for GroveDiscoveryError {}

/// Parse a .git file (used by worktrees) to extract the gitdir path.
pub fn parse_git_file(git_file_path: &Path) -> Result<String, String> {
    let content = fs::read_to_string(git_file_path)
        .map_err(|e| format!("Failed to read .git file: {}", e))?;
    let re = Regex::new(r"^gitdir:\s*(.+)$").unwrap();
    if let Some(caps) = re.captures(content.trim()) {
        Ok(caps[1].to_string())
    } else {
        Err(format!(
            "Invalid .git file format at {}",
            git_file_path.display()
        ))
    }
}

/// Extract the bare clone path from a worktree gitdir path.
pub fn extract_bare_clone_from_gitdir(gitdir_path: &str) -> Result<String, String> {
    // Look for .git/worktrees/ pattern
    let git_worktrees_pattern = ".git/worktrees/";
    if let Some(idx) = gitdir_path.find(git_worktrees_pattern) {
        return Ok(gitdir_path[..idx + 4].to_string()); // +4 for ".git"
    }

    // Fallback: try simple /worktrees/ pattern
    if let Some(idx) = gitdir_path.find("/worktrees/") {
        return Ok(gitdir_path[..idx].to_string());
    }

    Err(format!("Invalid worktree gitdir path: {}", gitdir_path))
}

/// Check if a path is a bare git repository using git commands.
fn is_bare_repository(repo_path: &Path) -> bool {
    Command::new("git")
        .args(["config", "--get", "core.bare"])
        .current_dir(repo_path)
        .output()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout).trim() == "true"
        })
        .unwrap_or(false)
}

/// Check if a path looks like a bare git repository by examining its structure.
fn is_bare_repo_by_structure(repo_path: &Path) -> bool {
    let head_path = repo_path.join("HEAD");
    let refs_path = repo_path.join("refs");
    let objects_path = repo_path.join("objects");
    let git_path = repo_path.join(".git");

    // Must NOT have a .git file or directory
    if git_path.exists() {
        return false;
    }

    // Must have HEAD file, refs directory, objects directory
    head_path.is_file() && refs_path.is_dir() && objects_path.is_dir()
}

/// Check if a path contains a .git FILE (worktree) vs a .git DIRECTORY (regular repo).
fn check_git_indicator(dir_path: &Path) -> (bool, bool, Option<PathBuf>) {
    let git_path = dir_path.join(".git");

    if let Ok(metadata) = fs::metadata(&git_path) {
        if metadata.is_file() {
            // .git FILE = worktree
            return (true, false, Some(git_path));
        } else if metadata.is_dir() {
            // .git DIRECTORY = regular repo
            return (false, true, Some(git_path));
        }
    }

    (false, false, None)
}

/// Discover the bare clone repository from the current working directory.
pub fn discover_bare_clone(start_path: Option<&Path>) -> Result<PathBuf, GroveDiscoveryError> {
    // 1. Check for GROVE_REPO environment variable
    if let Ok(env_repo) = env::var("GROVE_REPO") {
        let env_path = PathBuf::from(&env_repo);
        if is_bare_repository(&env_path) {
            return Ok(env_path);
        }
        env::remove_var("GROVE_REPO");
    }

    // Resolve starting path
    let current_path = if let Some(sp) = start_path {
        fs::canonicalize(sp).unwrap_or_else(|_| sp.to_path_buf())
    } else {
        let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        fs::canonicalize(&cwd).unwrap_or(cwd)
    };

    // 2. Check if current directory is a bare clone
    if is_bare_repo_by_structure(&current_path) {
        return Ok(current_path);
    }

    // 2b. Check if current directory contains a *.git bare clone
    if let Ok(entries) = fs::read_dir(&current_path) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                if ft.is_dir() {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.ends_with(".git") {
                            let potential = entry.path();
                            if is_bare_repo_by_structure(&potential) {
                                return Ok(potential);
                            }
                        }
                    }
                }
            }
        }
    }

    // 3 & 4. Traverse up looking for .git FILE (worktree indicator)
    let mut search_path = current_path.clone();
    let root = PathBuf::from("/");
    let mut found_regular_repo = false;

    while search_path != root {
        let (is_worktree, is_regular_repo, git_path) = check_git_indicator(&search_path);

        if is_worktree {
            if let Some(gp) = git_path {
                if let Ok(gitdir_path) = parse_git_file(&gp) {
                    let resolved_gitdir = if Path::new(&gitdir_path).is_absolute() {
                        PathBuf::from(&gitdir_path)
                    } else {
                        search_path.join(&gitdir_path)
                    };

                    if let Ok(bare_clone_path) =
                        extract_bare_clone_from_gitdir(&resolved_gitdir.to_string_lossy())
                    {
                        let bare_path = PathBuf::from(&bare_clone_path);
                        if is_bare_repository(&bare_path) {
                            return Ok(bare_path);
                        }
                    }
                }
            }
        } else if is_regular_repo && !found_regular_repo {
            found_regular_repo = true;
        }

        if let Some(parent) = search_path.parent() {
            search_path = parent.to_path_buf();
        } else {
            break;
        }
    }

    if found_regular_repo {
        return Err(GroveDiscoveryError {
            message: "This is a git repository but not a grove-managed worktree setup.\n\
                      Grove requires a bare clone with worktrees. Run `grove init <git-url>` in a different directory to create a new grove setup."
                .to_string(),
            is_regular_git_repo: true,
        });
    }

    Err(GroveDiscoveryError {
        message: "Not in a grove repository.\nRun `grove init <git-url>` to create one.".to_string(),
        is_regular_git_repo: false,
    })
}

/// Quick check to determine if the current directory is inside a grove-managed repository.
pub fn find_grove_repo(start_path: Option<&Path>) -> Option<PathBuf> {
    discover_bare_clone(start_path).ok()
}

/// Get the project root directory (parent of the bare clone).
pub fn get_project_root(bare_clone_path: &Path) -> PathBuf {
    bare_clone_path
        .parent()
        .unwrap_or(Path::new("/"))
        .to_path_buf()
}

// ============================================================================
// Update Notifications
// ============================================================================

/// Check for available updates (placeholder - just checks GitHub releases API).
#[allow(dead_code)]
pub fn check_for_updates(_current_version: &str) {
    // Silently skip - update checking via gh-release-update-notifier was TypeScript-specific.
    // For now, self-update command handles this directly.
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    // --- extractRepoName tests ---

    #[test]
    fn extract_repo_name_https_standard() {
        assert_eq!(
            extract_repo_name("https://github.com/user/my-repo.git").unwrap(),
            "my-repo"
        );
    }

    #[test]
    fn extract_repo_name_https_no_git_suffix() {
        assert_eq!(
            extract_repo_name("https://github.com/user/my-repo").unwrap(),
            "my-repo"
        );
    }

    #[test]
    fn extract_repo_name_gitlab_https() {
        assert_eq!(
            extract_repo_name("https://gitlab.com/org/project.git").unwrap(),
            "project"
        );
    }

    #[test]
    fn extract_repo_name_bitbucket_https() {
        assert_eq!(
            extract_repo_name("https://bitbucket.org/team/repo-name.git").unwrap(),
            "repo-name"
        );
    }

    #[test]
    fn extract_repo_name_self_hosted_with_ports() {
        assert_eq!(
            extract_repo_name("https://git.company.com:8443/team/project.git").unwrap(),
            "project"
        );
    }

    #[test]
    fn extract_repo_name_nested_https() {
        assert_eq!(
            extract_repo_name("https://github.com/org/group/subgroup/repo.git").unwrap(),
            "repo"
        );
    }

    #[test]
    fn extract_repo_name_ssh_standard() {
        assert_eq!(
            extract_repo_name("git@github.com:user/my-repo.git").unwrap(),
            "my-repo"
        );
    }

    #[test]
    fn extract_repo_name_ssh_no_git_suffix() {
        assert_eq!(
            extract_repo_name("git@github.com:user/my-repo").unwrap(),
            "my-repo"
        );
    }

    #[test]
    fn extract_repo_name_ssh_nested() {
        assert_eq!(
            extract_repo_name("git@github.com:org/group/repo.git").unwrap(),
            "repo"
        );
    }

    #[test]
    fn extract_repo_name_local_path() {
        assert_eq!(
            extract_repo_name("/home/user/projects/my-repo").unwrap(),
            "my-repo"
        );
    }

    #[test]
    fn extract_repo_name_local_path_git_suffix() {
        assert_eq!(
            extract_repo_name("/home/user/projects/my-repo.git").unwrap(),
            "my-repo"
        );
    }

    #[test]
    fn extract_repo_name_relative_path() {
        assert_eq!(extract_repo_name("./my-repo.git").unwrap(), "my-repo");
    }

    #[test]
    fn extract_repo_name_simple() {
        assert_eq!(extract_repo_name("my-repo").unwrap(), "my-repo");
    }

    #[test]
    fn extract_repo_name_special_chars() {
        assert_eq!(
            extract_repo_name("https://github.com/user/my-awesome-repo.git").unwrap(),
            "my-awesome-repo"
        );
        assert_eq!(
            extract_repo_name("https://github.com/user/my_repo.git").unwrap(),
            "my_repo"
        );
        assert_eq!(
            extract_repo_name("https://github.com/user/my.repo.git").unwrap(),
            "my.repo"
        );
        assert_eq!(
            extract_repo_name("https://github.com/user/repo123.git").unwrap(),
            "repo123"
        );
        assert_eq!(
            extract_repo_name("git@github.com:user/My_Repo-v2.0.git").unwrap(),
            "My_Repo-v2.0"
        );
    }

    #[test]
    fn extract_repo_name_empty_string() {
        assert!(extract_repo_name("").is_err());
    }

    #[test]
    fn extract_repo_name_just_git() {
        assert!(extract_repo_name(".git").is_err());
    }

    #[test]
    fn extract_repo_name_invalid_ssh() {
        assert!(extract_repo_name("git@").is_err());
    }

    #[test]
    fn extract_repo_name_dot_path() {
        assert!(extract_repo_name(".").is_err());
    }

    #[test]
    fn extract_repo_name_double_dot_https() {
        assert!(extract_repo_name("https://github.com/user/..").is_err());
    }

    #[test]
    fn extract_repo_name_double_dot_ssh() {
        assert!(extract_repo_name("git@github.com:user/..").is_err());
    }

    // --- isValidGitUrl tests ---

    #[test]
    fn valid_git_url_https() {
        assert!(is_valid_git_url("https://github.com/user/repo.git"));
        assert!(is_valid_git_url("https://github.com/user/repo"));
        assert!(is_valid_git_url("http://github.com/user/repo"));
    }

    #[test]
    fn valid_git_url_ssh() {
        assert!(is_valid_git_url("git@github.com:user/repo.git"));
        assert!(is_valid_git_url("ssh://git@github.com/user/repo.git"));
    }

    #[test]
    fn invalid_git_url() {
        assert!(!is_valid_git_url(""));
        assert!(!is_valid_git_url("/path/to/repo"));
        assert!(!is_valid_git_url("./repo"));
        assert!(!is_valid_git_url("file:///path/to/repo"));
        assert!(!is_valid_git_url("my-repo"));
        assert!(!is_valid_git_url("git@github.com"));
    }

    // --- normalizeDuration tests ---

    #[test]
    fn normalize_duration_human_friendly() {
        assert_eq!(normalize_duration("30d"), "P30D");
        assert_eq!(normalize_duration("2w"), "P2W");
        assert_eq!(normalize_duration("6M"), "P6M");
        assert_eq!(normalize_duration("1y"), "P1Y");
        assert_eq!(normalize_duration("12h"), "PT12H");
        assert_eq!(normalize_duration("30m"), "PT30M");
        assert_eq!(normalize_duration("45s"), "PT45S");
        assert_eq!(normalize_duration("30D"), "P30D");
        assert_eq!(normalize_duration("30 d"), "P30D");
        assert_eq!(normalize_duration("1.5d"), "P1.5D");
    }

    #[test]
    fn normalize_duration_iso8601_passthrough() {
        assert_eq!(normalize_duration("P30D"), "P30D");
        assert_eq!(normalize_duration("P2W"), "P2W");
        assert_eq!(normalize_duration("PT1H"), "PT1H");
        assert_eq!(normalize_duration("p30d"), "p30d");
    }

    #[test]
    fn normalize_duration_invalid_passthrough() {
        assert_eq!(normalize_duration(""), "");
        assert_eq!(normalize_duration("30 days"), "30 days");
        assert_eq!(normalize_duration("30"), "30");
    }

    // --- parseDuration tests ---

    #[test]
    fn parse_duration_iso8601() {
        assert_eq!(parse_duration("P30D").unwrap(), 30 * 24 * 60 * 60 * 1000);
        assert_eq!(parse_duration("P2W").unwrap(), 14 * 24 * 60 * 60 * 1000);
        assert_eq!(parse_duration("P1Y").unwrap(), 365 * 24 * 60 * 60 * 1000);
        assert_eq!(parse_duration("P3M").unwrap(), 90 * 24 * 60 * 60 * 1000);
        assert_eq!(parse_duration("PT1H").unwrap(), 60 * 60 * 1000);
        assert_eq!(parse_duration("PT30M").unwrap(), 30 * 60 * 1000);
        assert_eq!(
            parse_duration("P1DT12H").unwrap(),
            36 * 60 * 60 * 1000
        );
        assert_eq!(parse_duration("p30d").unwrap(), 30 * 24 * 60 * 60 * 1000);
    }

    #[test]
    fn parse_duration_human_friendly() {
        assert_eq!(parse_duration("30d").unwrap(), 30 * 24 * 60 * 60 * 1000);
        assert_eq!(parse_duration("2w").unwrap(), 14 * 24 * 60 * 60 * 1000);
        assert_eq!(parse_duration("6M").unwrap(), 180 * 24 * 60 * 60 * 1000);
        assert_eq!(parse_duration("1y").unwrap(), 365 * 24 * 60 * 60 * 1000);
        assert_eq!(parse_duration("12h").unwrap(), 12 * 60 * 60 * 1000);
        assert_eq!(parse_duration("30m").unwrap(), 30 * 60 * 1000);
        assert_eq!(parse_duration("45s").unwrap(), 45 * 1000);
        assert_eq!(parse_duration("30D").unwrap(), 30 * 24 * 60 * 60 * 1000);
        assert_eq!(parse_duration("30 d").unwrap(), 30 * 24 * 60 * 60 * 1000);
    }

    #[test]
    fn parse_duration_errors() {
        assert!(parse_duration("").is_err());
        assert!(parse_duration("   ").is_err());
        assert!(parse_duration("30 days").is_err());
        assert!(parse_duration("P0D").is_err());
        assert!(parse_duration("Pdays").is_err());
    }

    // --- formatCreatedTime tests ---

    #[test]
    fn format_created_time_epoch() {
        let epoch = DateTime::from_timestamp(0, 0).unwrap();
        assert_eq!(format_created_time(&epoch), "unknown");
    }

    #[test]
    fn format_created_time_minutes() {
        let thirty_min_ago = Utc::now() - Duration::minutes(30);
        assert_eq!(format_created_time(&thirty_min_ago), "30 minutes ago");
    }

    #[test]
    fn format_created_time_hours() {
        let two_hours_ago = Utc::now() - Duration::hours(2);
        assert_eq!(format_created_time(&two_hours_ago), "2 hours ago");
    }

    #[test]
    fn format_created_time_days() {
        let three_days_ago = Utc::now() - Duration::days(3);
        assert_eq!(format_created_time(&three_days_ago), "3 days ago");
    }

    #[test]
    fn format_created_time_weeks() {
        let two_weeks_ago = Utc::now() - Duration::weeks(2);
        assert_eq!(format_created_time(&two_weeks_ago), "2 weeks ago");
    }

    #[test]
    fn format_created_time_old_date() {
        let two_months_ago = Utc::now() - Duration::days(60);
        let result = format_created_time(&two_months_ago);
        let re = Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap();
        assert!(re.is_match(&result));
    }

    // --- formatPathWithTilde tests ---

    #[test]
    fn format_path_with_tilde_not_in_home() {
        assert_eq!(format_path_with_tilde("/tmp/projects/grove"), "/tmp/projects/grove");
    }

    // --- extractBareCloneFromGitdir tests ---

    #[test]
    fn extract_bare_clone_simple() {
        assert_eq!(
            extract_bare_clone_from_gitdir(
                "/home/user/projects/myproject/myproject.git/worktrees/main"
            )
            .unwrap(),
            "/home/user/projects/myproject/myproject.git"
        );
    }

    #[test]
    fn extract_bare_clone_nested_branch() {
        assert_eq!(
            extract_bare_clone_from_gitdir(
                "/home/user/projects/myproject/myproject.git/worktrees/feature/my-feature"
            )
            .unwrap(),
            "/home/user/projects/myproject/myproject.git"
        );
    }

    #[test]
    fn extract_bare_clone_deep_nesting() {
        assert_eq!(
            extract_bare_clone_from_gitdir("/a/b/c/repo.git/worktrees/feature/sub/deep").unwrap(),
            "/a/b/c/repo.git"
        );
    }

    #[test]
    fn extract_bare_clone_branch_named_worktrees() {
        assert_eq!(
            extract_bare_clone_from_gitdir("/home/user/repo.git/worktrees/fix/worktrees/bug")
                .unwrap(),
            "/home/user/repo.git"
        );
    }

    #[test]
    fn extract_bare_clone_no_worktrees() {
        assert!(extract_bare_clone_from_gitdir("/home/user/repo.git").is_err());
    }

    #[test]
    fn extract_bare_clone_empty() {
        assert!(extract_bare_clone_from_gitdir("").is_err());
    }

    // --- getProjectRoot tests ---

    #[test]
    fn get_project_root_normal() {
        let path = PathBuf::from("/home/user/projects/myproject/myproject.git");
        assert_eq!(
            get_project_root(&path),
            PathBuf::from("/home/user/projects/myproject")
        );
    }

    #[test]
    fn get_project_root_at_root() {
        let path = PathBuf::from("/myproject.git");
        assert_eq!(get_project_root(&path), PathBuf::from("/"));
    }

    #[test]
    fn get_project_root_nested() {
        let path = PathBuf::from("/a/b/c/d/repo.git");
        assert_eq!(get_project_root(&path), PathBuf::from("/a/b/c/d"));
    }

    // --- GroveDiscoveryError tests ---

    #[test]
    fn grove_discovery_error_basic() {
        let error = GroveDiscoveryError {
            message: "Not in a grove repository".to_string(),
            is_regular_git_repo: false,
        };
        assert_eq!(error.message, "Not in a grove repository");
        assert!(!error.is_regular_git_repo);
    }

    #[test]
    fn grove_discovery_error_with_regular_repo() {
        let error = GroveDiscoveryError {
            message: "Not a grove repo".to_string(),
            is_regular_git_repo: true,
        };
        assert_eq!(error.message, "Not a grove repo");
        assert!(error.is_regular_git_repo);
    }
}
