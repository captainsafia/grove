use chrono::{DateTime, TimeZone, Utc};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::models::Worktree;
use crate::utils::{discover_bare_clone, get_project_root, trim_trailing_branch_slashes};

pub const MAIN_BRANCHES: &[&str] = &["main", "master"];
pub const DETACHED_HEAD: &str = "detached HEAD";

pub struct RepoContext {
    repo_path: PathBuf,
    project_root: PathBuf,
}

/// Discover the grove repository and return the repo context.
pub fn discover_repo() -> Result<RepoContext, String> {
    let bare_clone_path = discover_bare_clone(None).map_err(|e| e.message)?;
    let project_root = get_project_root(&bare_clone_path);

    // Cache the discovered path
    env::set_var("GROVE_REPO", &bare_clone_path);

    Ok(RepoContext {
        repo_path: bare_clone_path,
        project_root,
    })
}

pub fn repo_path(context: &RepoContext) -> &Path {
    &context.repo_path
}

pub fn project_root(context: &RepoContext) -> &Path {
    &context.project_root
}

fn git_raw(context: &RepoContext, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(&context.repo_path)
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(stderr.trim().to_string())
    }
}

pub fn list_worktrees(context: &RepoContext) -> Result<Vec<Worktree>, String> {
    let result = git_raw(context, &["worktree", "list", "--porcelain"])
        .map_err(|e| format!("Failed to list worktrees: {}", e))?;

    let partials = parse_worktree_lines(&result);
    let mut worktrees = Vec::new();
    for partial in partials {
        worktrees.push(complete_worktree_info(partial));
    }
    Ok(worktrees)
}

pub fn branch_exists(context: &RepoContext, branch: &str) -> bool {
    git_raw(
        context,
        &["rev-parse", "--verify", &format!("refs/heads/{}", branch)],
    )
    .is_ok()
}

pub fn is_branch_merged(
    context: &RepoContext,
    branch: &str,
    base_branch: &str,
) -> Result<bool, String> {
    // First, check for regular merges
    let result = git_raw(context, &["branch", "--merged", base_branch])
        .map_err(|e| format!("Failed to check if branch {} is merged: {}", branch, e))?;

    let merged_branches: Vec<&str> = result
        .lines()
        .map(|line| line.trim().trim_start_matches("* ").trim())
        .filter(|line| !line.is_empty())
        .collect();

    if merged_branches.contains(&branch) {
        return Ok(true);
    }

    // Check for squash merges
    is_squash_merged(context, branch, base_branch)
}

fn is_squash_merged(
    context: &RepoContext,
    branch: &str,
    base_branch: &str,
) -> Result<bool, String> {
    let branch_files = git_raw(
        context,
        &[
            "diff",
            "--name-only",
            &format!("{}...{}", base_branch, branch),
        ],
    )
    .unwrap_or_default();

    let files: Vec<&str> = branch_files.lines().filter(|f| !f.is_empty()).collect();

    if files.is_empty() {
        return Ok(true);
    }

    let mut diff_args = vec!["diff", "--name-only", base_branch, branch, "--"];
    diff_args.extend(files);

    let diff = git_raw(context, &diff_args).unwrap_or_default();
    Ok(diff.trim().is_empty())
}

pub fn clone_bare_repository(git_url: &str, target_dir: &str) -> Result<(), String> {
    let output = Command::new("git")
        .args(["clone", "--bare", git_url, target_dir])
        .output()
        .map_err(|e| format!("Failed to clone repository: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to clone repository: {}", stderr.trim()));
    }

    // Configure fetch refspec
    let output = Command::new("git")
        .args([
            "config",
            "remote.origin.fetch",
            "+refs/heads/*:refs/remotes/origin/*",
        ])
        .current_dir(target_dir)
        .output()
        .map_err(|e| format!("Failed to configure repository: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to configure repository: {}", stderr.trim()));
    }

    Ok(())
}

pub fn add_worktree(
    context: &RepoContext,
    worktree_path: &str,
    branch_name: &str,
    create_branch: bool,
    track: Option<&str>,
) -> Result<(), String> {
    if create_branch {
        if let Some(track_branch) = track {
            ensure_tracking_reference(context, track_branch)?;
        }
    }

    let args = build_add_worktree_args(worktree_path, branch_name, create_branch, track);

    git_raw(context, &args).map_err(|e| format!("Failed to add worktree: {}", e))?;
    Ok(())
}

fn build_add_worktree_args<'a>(
    worktree_path: &'a str,
    branch_name: &'a str,
    create_branch: bool,
    track: Option<&'a str>,
) -> Vec<&'a str> {
    let mut args = vec!["worktree", "add"];

    if create_branch {
        args.push("-b");
        args.push(branch_name);
        if track.is_some() {
            args.push("--track");
        }
        args.push(worktree_path);
        if let Some(track_branch) = track {
            args.push(track_branch);
        }
    } else {
        args.push(worktree_path);
        args.push(branch_name);
    }

    args
}

fn ensure_tracking_reference(context: &RepoContext, track_ref: &str) -> Result<(), String> {
    if reference_exists(context, track_ref) {
        return Ok(());
    }

    let (remote, branch) = parse_remote_tracking_reference(track_ref).ok_or_else(|| {
        format!(
            "Tracking reference '{}' does not exist. Use a valid remote-tracking branch like 'origin/main'.",
            track_ref
        )
    })?;

    let canonical_ref = format!("refs/remotes/{}/{}", remote, branch);
    if reference_exists(context, &canonical_ref) {
        return Ok(());
    }

    let fetch_refspec = format!("{}:{}", branch, canonical_ref);
    git_raw(context, &["fetch", remote, &fetch_refspec])
        .map_err(|e| format!("Failed to fetch tracking branch '{}': {}", track_ref, e))?;

    if reference_exists(context, track_ref) || reference_exists(context, &canonical_ref) {
        Ok(())
    } else {
        Err(format!(
            "Tracking reference '{}' is still unavailable after fetching from remote '{}'.",
            track_ref, remote
        ))
    }
}

fn reference_exists(context: &RepoContext, reference: &str) -> bool {
    git_raw(context, &["rev-parse", "--verify", reference]).is_ok()
}

fn parse_remote_tracking_reference(reference: &str) -> Option<(&str, &str)> {
    let normalized = if let Some(rest) = reference.strip_prefix("refs/remotes/") {
        rest
    } else if reference.starts_with("refs/") {
        return None;
    } else {
        reference
    };

    let (remote, branch) = normalized.split_once('/')?;
    if remote.is_empty() || branch.is_empty() {
        return None;
    }

    Some((remote, branch))
}

pub fn remove_worktree(
    context: &RepoContext,
    worktree_path: &str,
    force: bool,
) -> Result<(), String> {
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(worktree_path);

    git_raw(context, &args).map_err(|e| format!("Failed to remove worktree: {}", e))?;
    Ok(())
}

pub fn remove_worktrees(
    context: &RepoContext,
    worktrees: &[Worktree],
    force: bool,
) -> (Vec<String>, Vec<(String, String)>) {
    let mut removed = Vec::new();
    let mut failed = Vec::new();

    for wt in worktrees {
        match remove_worktree(context, &wt.path, force) {
            Ok(()) => removed.push(wt.path.clone()),
            Err(e) => failed.push((wt.path.clone(), e)),
        }
    }

    (removed, failed)
}

pub fn get_default_branch(context: &RepoContext) -> Result<String, String> {
    // Try to get the default branch from the remote HEAD
    if let Ok(result) = git_raw(context, &["symbolic-ref", "refs/remotes/origin/HEAD"]) {
        let branch = result.trim().replace("refs/remotes/origin/", "");
        return Ok(branch);
    }

    // Fallback: check if main or master exists
    if branch_exists(context, "main") {
        return Ok("main".to_string());
    }
    if branch_exists(context, "master") {
        return Ok("master".to_string());
    }

    Err("Could not determine default branch. Please specify with --branch.".to_string())
}

pub fn sync_branch(context: &RepoContext, branch: &str) -> Result<(), String> {
    git_raw(
        context,
        &["fetch", "origin", &format!("{}:{}", branch, branch)],
    )
    .map_err(|e| format!("Failed to sync branch '{}': {}", branch, e))?;
    Ok(())
}

pub fn find_worktree_by_name(
    context: &RepoContext,
    name: &str,
) -> Result<Option<Worktree>, String> {
    let worktrees = list_worktrees(context)?;
    Ok(match_worktree_by_name(&worktrees, name).cloned())
}

fn match_worktree_by_name<'a>(worktrees: &'a [Worktree], name: &str) -> Option<&'a Worktree> {
    let normalized_name = trim_trailing_branch_slashes(name);

    if normalized_name.is_empty() {
        return None;
    }

    // First, try exact branch name match.
    if let Some(wt) = worktrees.iter().find(|wt| wt.branch == normalized_name) {
        return Some(wt);
    }

    // Try matching by directory name.
    if let Some(wt) = worktrees.iter().find(|wt| {
        Path::new(&wt.path)
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n == normalized_name)
            .unwrap_or(false)
    }) {
        return Some(wt);
    }

    // Try partial branch name match (suffix matching).
    worktrees
        .iter()
        .find(|wt| wt.branch.ends_with(&format!("/{}", normalized_name)))
}

struct PartialWorktree {
    path: Option<String>,
    head: Option<String>,
    branch: Option<String>,
    is_locked: bool,
    is_prunable: bool,
    is_bare: bool,
}

fn parse_worktree_lines(output: &str) -> Vec<PartialWorktree> {
    let mut worktrees = Vec::new();
    let mut current = PartialWorktree {
        path: None,
        head: None,
        branch: None,
        is_locked: false,
        is_prunable: false,
        is_bare: false,
    };

    for line in output.trim().lines() {
        if line.starts_with("worktree ") {
            if current.path.is_some() && !current.is_bare {
                worktrees.push(current);
            }
            current = PartialWorktree {
                path: Some(line[9..].to_string()),
                head: None,
                branch: None,
                is_locked: false,
                is_prunable: false,
                is_bare: false,
            };
        } else if line.starts_with("HEAD ") {
            current.head = Some(line[5..].to_string());
        } else if line.starts_with("branch ") {
            current.branch = Some(line[7..].replace("refs/heads/", ""));
        } else if line == "detached" {
            current.branch = Some(DETACHED_HEAD.to_string());
        } else if line == "locked" {
            current.is_locked = true;
        } else if line == "prunable" {
            current.is_prunable = true;
        } else if line == "bare" {
            current.is_bare = true;
        }
    }

    if current.path.is_some() && !current.is_bare {
        worktrees.push(current);
    }

    worktrees
}

fn complete_worktree_info(partial: PartialWorktree) -> Worktree {
    let path = partial.path.unwrap_or_default();
    let branch = partial.branch.unwrap_or_default();
    let head = partial.head.unwrap_or_default();

    let is_main = MAIN_BRANCHES.contains(&branch.as_str());

    // Check if worktree is dirty
    let is_dirty = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&path)
        .output()
        .map(|output| !output.stdout.is_empty())
        .unwrap_or(false);

    // Try to get creation time from filesystem with Unix fallbacks.
    let created_at = fs::metadata(&path)
        .ok()
        .and_then(|meta| metadata_created_at(&meta))
        .unwrap_or_else(|| DateTime::from_timestamp(0, 0).unwrap());

    Worktree {
        path,
        branch,
        head,
        created_at,
        is_dirty,
        is_locked: partial.is_locked,
        is_prunable: partial.is_prunable,
        is_main,
    }
}

fn system_time_to_datetime(system_time: std::time::SystemTime) -> Option<DateTime<Utc>> {
    let duration = system_time.duration_since(std::time::UNIX_EPOCH).ok()?;
    Utc.timestamp_opt(duration.as_secs() as i64, 0).single()
}

fn metadata_created_at(meta: &fs::Metadata) -> Option<DateTime<Utc>> {
    if let Ok(st) = meta.created() {
        return system_time_to_datetime(st);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let ctime = meta.ctime();
        if ctime > 0 {
            return Utc.timestamp_opt(ctime, 0).single();
        }
        let mtime = meta.mtime();
        if mtime > 0 {
            return Utc.timestamp_opt(mtime, 0).single();
        }
    }

    #[cfg(not(unix))]
    {
        if let Ok(st) = meta.modified() {
            return system_time_to_datetime(st);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;

    fn make_worktree(path: &str, branch: &str) -> Worktree {
        Worktree {
            path: path.to_string(),
            branch: branch.to_string(),
            head: "abc123".to_string(),
            created_at: DateTime::from_timestamp(0, 0).unwrap(),
            is_dirty: false,
            is_locked: false,
            is_prunable: false,
            is_main: false,
        }
    }

    // --- parseWorktreeLines tests ---

    #[test]
    fn parse_locked_worktree() {
        let output = "worktree /path/to/worktree\nHEAD abc123def456\nbranch refs/heads/feature-branch\nlocked\n";
        let worktrees = parse_worktree_lines(output);
        assert_eq!(worktrees.len(), 1);
        assert!(worktrees[0].is_locked);
    }

    #[test]
    fn parse_prunable_worktree() {
        let output = "worktree /path/to/worktree\nHEAD abc123def456\nbranch refs/heads/stale-branch\nprunable\n";
        let worktrees = parse_worktree_lines(output);
        assert_eq!(worktrees.len(), 1);
        assert!(worktrees[0].is_prunable);
    }

    #[test]
    fn parse_detached_head() {
        let output = "worktree /path/to/worktree\nHEAD abc123def456\ndetached\n";
        let worktrees = parse_worktree_lines(output);
        assert_eq!(worktrees.len(), 1);
        assert_eq!(worktrees[0].branch.as_deref(), Some("detached HEAD"));
    }

    #[test]
    fn parse_main_branch() {
        let output = "worktree /path/to/main-worktree\nHEAD abc123def456\nbranch refs/heads/main\n";
        let worktrees = parse_worktree_lines(output);
        assert_eq!(worktrees.len(), 1);
        assert_eq!(worktrees[0].branch.as_deref(), Some("main"));
    }

    #[test]
    fn parse_master_branch() {
        let output =
            "worktree /path/to/master-worktree\nHEAD abc123def456\nbranch refs/heads/master\n";
        let worktrees = parse_worktree_lines(output);
        assert_eq!(worktrees.len(), 1);
        assert_eq!(worktrees[0].branch.as_deref(), Some("master"));
    }

    #[test]
    fn skip_bare_repository() {
        let output = "worktree /path/to/bare-repo\nbare\n\nworktree /path/to/regular-worktree\nHEAD abc123def456\nbranch refs/heads/feature\n";
        let worktrees = parse_worktree_lines(output);
        assert_eq!(worktrees.len(), 1);
        assert_eq!(worktrees[0].branch.as_deref(), Some("feature"));
    }

    #[test]
    fn parse_multiple_worktrees() {
        let output = "worktree /path/to/main\nHEAD abc123\nbranch refs/heads/main\n\nworktree /path/to/feature1\nHEAD def456\nbranch refs/heads/feature/one\nlocked\n\nworktree /path/to/feature2\nHEAD 789abc\nbranch refs/heads/feature/two\nprunable\n";
        let worktrees = parse_worktree_lines(output);
        assert_eq!(worktrees.len(), 3);
        assert_eq!(worktrees[0].branch.as_deref(), Some("main"));
        assert!(worktrees[1].is_locked);
        assert!(worktrees[2].is_prunable);
    }

    #[test]
    fn match_worktree_by_name_trims_trailing_slashes() {
        let worktrees = vec![
            make_worktree("/repo/main", "main"),
            make_worktree("/repo/feature/my-branch", "feature/my-branch"),
        ];

        let found = match_worktree_by_name(&worktrees, "feature/my-branch/");
        assert_eq!(
            found.map(|wt| wt.branch.as_str()),
            Some("feature/my-branch")
        );
    }

    #[test]
    fn match_worktree_by_name_suffix_match_with_trailing_slash() {
        let worktrees = vec![make_worktree(
            "/repo/feature/my-branch",
            "feature/my-branch",
        )];

        let found = match_worktree_by_name(&worktrees, "my-branch/");
        assert_eq!(
            found.map(|wt| wt.branch.as_str()),
            Some("feature/my-branch")
        );
    }

    #[test]
    fn build_add_worktree_args_for_new_branch_with_track() {
        let args = build_add_worktree_args(
            "/tmp/repo/pr-9148",
            "pr-9148",
            true,
            Some("origin/some-remote-branch"),
        );

        assert_eq!(
            args,
            vec![
                "worktree",
                "add",
                "-b",
                "pr-9148",
                "--track",
                "/tmp/repo/pr-9148",
                "origin/some-remote-branch",
            ]
        );
    }

    #[test]
    fn build_add_worktree_args_for_new_branch_without_track() {
        let args = build_add_worktree_args("/tmp/repo/feature", "feature", true, None);

        assert_eq!(
            args,
            vec!["worktree", "add", "-b", "feature", "/tmp/repo/feature"]
        );
    }

    #[test]
    fn build_add_worktree_args_for_existing_branch_ignores_track() {
        let args = build_add_worktree_args(
            "/tmp/repo/existing",
            "existing",
            false,
            Some("origin/existing"),
        );

        assert_eq!(
            args,
            vec!["worktree", "add", "/tmp/repo/existing", "existing"]
        );
    }

    #[test]
    fn parse_remote_tracking_reference_short_form() {
        assert_eq!(
            parse_remote_tracking_reference("origin/feature/test"),
            Some(("origin", "feature/test"))
        );
    }

    #[test]
    fn parse_remote_tracking_reference_full_ref_form() {
        assert_eq!(
            parse_remote_tracking_reference("refs/remotes/upstream/main"),
            Some(("upstream", "main"))
        );
    }

    #[test]
    fn parse_remote_tracking_reference_rejects_non_remote_refs() {
        assert_eq!(
            parse_remote_tracking_reference("refs/heads/feature/test"),
            None
        );
        assert_eq!(parse_remote_tracking_reference("origin"), None);
    }
}
