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

/// Where a `git` invocation targets, scoping which repository it operates on.
///
/// Every `Command::new("git")` in this crate must go through
/// [`build_git_command`] with one of these targets, so that the right scoping
/// mechanism is applied uniformly and the bare-repo identification rules
/// (see [`build_git_command`]) cannot be re-introduced incorrectly at a
/// future callsite.
enum GitTarget<'a> {
    /// Operates on an existing bare repository. The path is identified via
    /// `GIT_DIR` so the command works under `safe.bareRepository=explicit`,
    /// and is normalized to strip Windows `\\?\` extended-length prefixes
    /// (which git rejects in path arguments).
    BareRepo(&'a Path),
    /// Operates inside a working tree. The path is set as the command's
    /// working directory; git's own discovery finds the repository from
    /// there.
    WorkTree(&'a Path),
    /// Operates without a pre-existing repository target (e.g. `git clone`,
    /// `git --version`). No scoping is applied.
    Unbound,
}

/// Build a `git` command for a given target.
///
/// This is the single funnel for every `git` invocation in the crate. Routing
/// all invocations through one function gives us:
///
/// - A uniform answer to "how do I scope this command to the right repo?"
///   for bare repos (`GIT_DIR` + Windows path normalization) vs. worktrees
///   (`current_dir`) vs. unbound operations (clone, version, etc.).
/// - A single place to test the scoping invariants without spinning up real
///   repositories on disk.
/// - Visible centralization: a future PR that adds a new direct
///   `Command::new("git")` stands out in review against the established
///   pattern of going through this helper.
///
/// Why `GIT_DIR` for bare repos: `safe.bareRepository=explicit` (set by agent
/// shells like GitHub Copilot CLI and by hardened environments) disables
/// git's CWD-based bare-repo discovery and requires explicit identification
/// via `GIT_DIR` or `--git-dir`. See
/// <https://git-scm.com/docs/git-config#Documentation/git-config.txt-safebareRepository>.
///
/// Why the `\\?\` strip for bare repos: `std::fs::canonicalize` on Windows
/// always returns paths prefixed with `\\?\` (the extended-length
/// representation). Git accepts such paths as a process working directory
/// because Win32 round-trips them transparently, but rejects them in
/// `GIT_DIR` / `--git-dir` because git's portable path parser does not
/// recognize the prefix. See <https://github.com/rust-lang/rust/issues/42869>.
fn build_git_command(target: GitTarget<'_>, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    match target {
        GitTarget::BareRepo(path) => {
            let normalized = normalize_path_for_git(&path.to_string_lossy());
            cmd.env("GIT_DIR", normalized);
        }
        GitTarget::WorkTree(path) => {
            cmd.current_dir(path);
        }
        GitTarget::Unbound => {}
    }
    cmd.args(args);
    cmd
}

fn git_raw(context: &RepoContext, args: &[&str]) -> Result<String, String> {
    let output = build_git_command(GitTarget::BareRepo(&context.repo_path), args)
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
    let output = build_git_command(
        GitTarget::Unbound,
        &["clone", "--bare", git_url, target_dir],
    )
    .output()
    .map_err(|e| format!("Failed to clone repository: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to clone repository: {}", stderr.trim()));
    }

    // Configure fetch refspec
    let output = build_git_command(
        GitTarget::BareRepo(Path::new(target_dir)),
        &[
            "config",
            "remote.origin.fetch",
            "+refs/heads/*:refs/remotes/origin/*",
        ],
    )
    .output()
    .map_err(|e| format!("Failed to configure repository: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to configure repository: {}", stderr.trim()));
    }

    // Populate refs/remotes/origin/* so subsequent commands (sync, --track,
    // get_default_branch, auto-upstream in add) can resolve origin/<branch>
    // without requiring the user to run an extra `git fetch origin`.
    let output = build_fetch_origin_command(target_dir)
        .output()
        .map_err(|e| format!("Failed to fetch from origin: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to fetch from origin: {}", stderr.trim()));
    }

    // Set refs/remotes/origin/HEAD so get_default_branch and downstream tools
    // can resolve the remote's default branch. Failure here is non-fatal:
    // older Git versions or unusual remote configurations may not support it,
    // and the fallback in get_default_branch still works.
    let _ = build_set_head_command(target_dir).output();

    Ok(())
}

/// Build the `git fetch origin` invocation that runs against the
/// just-cloned bare repository during `clone_bare_repository`.
///
/// Wrapped in its own function (rather than inlined) so that a unit test
/// can assert the command goes through `build_git_command(BareRepo(..))`
/// and not the older `current_dir(target_dir)` pattern. The `current_dir`
/// pattern breaks under `safe.bareRepository=explicit` because git's
/// CWD-based bare-repo discovery is disabled by that setting; the
/// `BareRepo` target sets `GIT_DIR` instead, which is unaffected.
fn build_fetch_origin_command(target_dir: &str) -> Command {
    build_git_command(
        GitTarget::BareRepo(Path::new(target_dir)),
        &["fetch", "origin"],
    )
}

/// Build the `git remote set-head origin --auto` invocation that runs
/// against the just-cloned bare repository during
/// `clone_bare_repository`. See [`build_fetch_origin_command`] for the
/// rationale on going through the `BareRepo` funnel.
fn build_set_head_command(target_dir: &str) -> Command {
    build_git_command(
        GitTarget::BareRepo(Path::new(target_dir)),
        &["remote", "set-head", "origin", "--auto"],
    )
}

pub fn add_worktree(
    context: &RepoContext,
    worktree_path: &str,
    branch_name: &str,
    create_branch: bool,
    track: Option<&str>,
) -> Result<(), String> {
    let normalized_track = match track {
        Some(track_branch) => Some(normalize_tracking_reference_input(track_branch)?),
        None => None,
    };

    if let Some(track_branch) = normalized_track.as_deref() {
        ensure_tracking_reference(context, track_branch)?;
    }

    let normalized_worktree_path = normalize_path_for_git(worktree_path);
    let args = build_add_worktree_args(
        normalized_worktree_path.as_str(),
        branch_name,
        create_branch,
        normalized_track.as_deref(),
    );

    git_raw(context, &args).map_err(|e| format!("Failed to add worktree: {}", e))?;
    if let Some(track_branch) = normalized_track.as_deref() {
        set_branch_upstream(context, branch_name, track_branch)?;
    } else {
        maybe_set_default_upstream(context, branch_name);
    }
    Ok(())
}

/// Set upstream tracking to `origin/<branch_name>` when grove can infer
/// that's what the user wants.
///
/// Rationale: bare-clone + worktree workflows produce local branches
/// that have no upstream. `refs/heads/*` are created by `git clone
/// --bare` without tracking info, which breaks `git push` / `git
/// status` until the user runs `git branch -u origin/<branch>`. This
/// helper sets the upstream automatically when
/// `refs/remotes/origin/<branch>` exists and the local branch doesn't
/// already have one. That's more eager than `git checkout` (which only
/// auto-tracks when *creating* a new branch from a remote-tracking
/// ref), but matches the workflow grove encapsulates.
///
/// Users who have set `branch.autoSetupMerge=false` are signaling they
/// don't want this class of auto-tracking, so we honor it as an
/// opt-out.
///
/// All conditions are pre-checks; nothing fails loudly. Worst case: no
/// upstream is set and the user runs `git branch -u origin/<branch>`
/// themselves, which is what they'd do today without this helper.
fn maybe_set_default_upstream(context: &RepoContext, branch_name: &str) {
    if auto_setup_merge_disabled(context) {
        return;
    }

    let remote_ref = format!("refs/remotes/origin/{}", branch_name);
    if !reference_exists(context, &remote_ref) {
        return;
    }

    if branch_has_upstream(context, branch_name) {
        return;
    }

    let upstream = format!("origin/{}", branch_name);
    let _ = git_raw(
        context,
        &["branch", "--set-upstream-to", &upstream, branch_name],
    );
}

fn auto_setup_merge_disabled(context: &RepoContext) -> bool {
    // `branch.autoSetupMerge` defaults to "true". Only an explicit "false"
    // (case-insensitive, optionally with surrounding whitespace) disables
    // auto-tracking. Other documented values ("true", "always", "simple",
    // "inherit") leave grove's behavior unchanged.
    match git_raw(context, &["config", "--get", "branch.autoSetupMerge"]) {
        Ok(value) => value.trim().eq_ignore_ascii_case("false"),
        Err(_) => false,
    }
}

fn branch_has_upstream(context: &RepoContext, branch_name: &str) -> bool {
    git_raw(
        context,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            &format!("{}@{{u}}", branch_name),
        ],
    )
    .is_ok()
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

pub fn normalize_tracking_reference_input(reference: &str) -> Result<String, String> {
    let normalized = trim_trailing_branch_slashes(reference);
    let (remote, branch) = parse_remote_tracking_reference(normalized)
        .ok_or_else(|| invalid_tracking_reference(reference))?;

    if !is_valid_ref_component(remote) || !is_valid_ref_path(branch) {
        return Err(invalid_tracking_reference(reference));
    }

    Ok(format!("{}/{}", remote, branch))
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

pub fn tracked_branch_name(reference: &str) -> Option<&str> {
    parse_remote_tracking_reference(reference).map(|(_, branch)| branch)
}

fn invalid_tracking_reference(reference: &str) -> String {
    format!(
        "Invalid tracking branch '{}'. Use '<remote>/<branch>' or 'refs/remotes/<remote>/<branch>'.",
        reference
    )
}

fn is_valid_ref_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains("@{")
        && !path.ends_with('.')
        && path.split('/').all(is_valid_ref_component)
}

fn is_valid_ref_component(component: &str) -> bool {
    !component.is_empty()
        && component != "."
        && component != ".."
        && !component.starts_with('.')
        && !component.ends_with(".lock")
        && !component.contains("..")
        && !component.chars().any(contains_invalid_ref_char)
}

fn contains_invalid_ref_char(ch: char) -> bool {
    ch.is_ascii_control() || matches!(ch, ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\')
}

fn set_branch_upstream(
    context: &RepoContext,
    branch_name: &str,
    track_ref: &str,
) -> Result<(), String> {
    let upstream = normalize_tracking_reference(track_ref);
    git_raw(
        context,
        &["branch", "--set-upstream-to", &upstream, branch_name],
    )
    .map_err(|e| {
        format!(
            "Failed to set upstream '{}' for branch '{}': {}",
            upstream, branch_name, e
        )
    })?;
    Ok(())
}

fn normalize_tracking_reference(track_ref: &str) -> String {
    if let Some((remote, branch)) = parse_remote_tracking_reference(track_ref) {
        return format!("{}/{}", remote, branch);
    }

    track_ref.to_string()
}

pub fn remove_worktree(
    context: &RepoContext,
    worktree_path: &str,
    force: bool,
) -> Result<(), String> {
    let normalized_worktree_path = normalize_path_for_git(worktree_path);
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(normalized_worktree_path.as_str());

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
        if let Some(path) = line.strip_prefix("worktree ") {
            if current.path.is_some() && !current.is_bare {
                worktrees.push(current);
            }
            current = PartialWorktree {
                path: Some(path.to_string()),
                head: None,
                branch: None,
                is_locked: false,
                is_prunable: false,
                is_bare: false,
            };
        } else if let Some(head) = line.strip_prefix("HEAD ") {
            current.head = Some(head.to_string());
        } else if let Some(branch) = line.strip_prefix("branch ") {
            current.branch = Some(branch.replace("refs/heads/", ""));
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
    let is_dirty = build_git_command(
        GitTarget::WorkTree(Path::new(&path)),
        &["status", "--porcelain"],
    )
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

fn normalize_path_for_git(path: &str) -> String {
    if let Some(stripped) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", stripped);
    }
    if let Some(stripped) = path.strip_prefix(r"\\?\") {
        return stripped.to_string();
    }

    path.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;
    use std::ffi::OsStr;

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
    fn normalize_path_for_git_strips_windows_extended_prefix() {
        assert_eq!(
            normalize_path_for_git(r"\\?\C:\Users\dev\repo\feature-worktree"),
            r"C:\Users\dev\repo\feature-worktree"
        );
    }

    #[test]
    fn normalize_path_for_git_converts_unc_extended_prefix() {
        assert_eq!(
            normalize_path_for_git(r"\\?\UNC\server\share\repo\feature-worktree"),
            r"\\server\share\repo\feature-worktree"
        );
    }

    #[test]
    fn normalize_path_for_git_preserves_normal_paths() {
        let path = "/home/dev/repo/feature-worktree";
        assert_eq!(normalize_path_for_git(path), path);
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

    #[test]
    fn normalize_tracking_reference_input_trims_trailing_slash() {
        assert_eq!(
            normalize_tracking_reference_input("origin/feature/test/").unwrap(),
            "origin/feature/test"
        );
    }

    #[test]
    fn normalize_tracking_reference_input_normalizes_full_ref() {
        assert_eq!(
            normalize_tracking_reference_input("refs/remotes/origin/feature/test/").unwrap(),
            "origin/feature/test"
        );
    }

    #[test]
    fn normalize_tracking_reference_input_rejects_empty_branch() {
        assert!(normalize_tracking_reference_input("origin/").is_err());
    }

    #[test]
    fn normalize_tracking_reference_input_rejects_empty_path_segment() {
        assert!(normalize_tracking_reference_input("origin/feature//test").is_err());
    }

    #[test]
    fn tracked_branch_name_returns_remote_branch_part() {
        assert_eq!(
            tracked_branch_name("origin/cursor/track-flag-worktree-issue-94b3"),
            Some("cursor/track-flag-worktree-issue-94b3")
        );
    }

    #[test]
    fn normalize_tracking_reference_for_full_ref() {
        assert_eq!(
            normalize_tracking_reference("refs/remotes/origin/feature/test"),
            "origin/feature/test"
        );
    }

    #[test]
    fn normalize_tracking_reference_keeps_short_form() {
        assert_eq!(
            normalize_tracking_reference("origin/feature/test"),
            "origin/feature/test"
        );
    }

    // --- build_git_command tests ---
    //
    // These tests pin the invariants of the single funnel that all `git`
    // invocations in this crate must go through. Routing every Command::new("git")
    // through build_git_command makes the scoping policy uniform across
    // bare-repo, worktree, and unbound invocations, and means a future PR
    // adding a new direct Command::new("git") stands out against the
    // established pattern in code review.
    //
    // Bug 1 motivation: `safe.bareRepository=explicit` (set by agent shells
    // such as GitHub Copilot CLI 1.0+ and by hardened corporate environments)
    // disables git's CWD-based bare-repo discovery and requires explicit
    // identification via GIT_DIR. See
    // https://git-scm.com/docs/git-config#Documentation/git-config.txt-safebareRepository
    //
    // Bug 2 motivation: `std::fs::canonicalize` on Windows returns paths
    // prefixed with `\\?\`. Git accepts those as a process working directory
    // but rejects them when supplied via GIT_DIR or --git-dir. See
    // https://github.com/rust-lang/rust/issues/42869

    #[test]
    fn build_git_command_bare_repo_sets_git_dir_env_var() {
        let repo_path = PathBuf::from("/tmp/grove-test/repo.git");
        let cmd = build_git_command(GitTarget::BareRepo(&repo_path), &["worktree", "list"]);

        let git_dir = cmd
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("GIT_DIR"))
            .map(|(_, value)| value);

        assert!(
            git_dir.is_some(),
            "BareRepo target must set GIT_DIR so git operates explicitly on the \
             bare repository, satisfying safe.bareRepository=explicit"
        );
        assert_eq!(
            git_dir.unwrap(),
            Some(repo_path.as_os_str()),
            "GIT_DIR must point at the bare repository path"
        );
    }

    #[test]
    fn build_git_command_bare_repo_does_not_set_current_dir() {
        let repo_path = PathBuf::from("/tmp/grove-test/repo.git");
        let cmd = build_git_command(GitTarget::BareRepo(&repo_path), &["worktree", "list"]);

        // Re-introducing current_dir on the bare repo path would re-enable the
        // safe.bareRepository=explicit failure mode that GIT_DIR is meant to
        // avoid.
        let working_dir = cmd.get_current_dir();
        assert!(
            working_dir.is_none(),
            "BareRepo target must not set a working directory; rely on GIT_DIR. \
             Got working_dir={:?}",
            working_dir
        );
    }

    #[test]
    fn build_git_command_bare_repo_normalizes_windows_extended_prefix() {
        // `std::fs::canonicalize` on Windows returns paths with the `\\?\`
        // extended-length prefix. Git accepts these as a process working
        // directory but rejects them in GIT_DIR / --git-dir. The helper must
        // strip the prefix before handing the path to git.
        let repo_path = PathBuf::from(r"\\?\D:\repo\bare.git");
        let cmd = build_git_command(GitTarget::BareRepo(&repo_path), &["worktree", "list"]);

        let git_dir = cmd
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("GIT_DIR"))
            .and_then(|(_, value)| value);

        assert_eq!(
            git_dir,
            Some(OsStr::new(r"D:\repo\bare.git")),
            "GIT_DIR must have the Windows extended-length prefix stripped"
        );
    }

    #[test]
    fn build_git_command_work_tree_sets_current_dir_and_no_git_dir() {
        let worktree_path = PathBuf::from("/tmp/grove-test/feature-x");
        let cmd = build_git_command(
            GitTarget::WorkTree(&worktree_path),
            &["status", "--porcelain"],
        );

        assert_eq!(
            cmd.get_current_dir(),
            Some(worktree_path.as_path()),
            "WorkTree target must set current_dir to the worktree path so git's \
             CWD-based discovery finds the repository"
        );

        let git_dir = cmd
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("GIT_DIR"));
        assert!(
            git_dir.is_none(),
            "WorkTree target must not set GIT_DIR; that would override git's \
             CWD-based discovery and could point at the wrong repository"
        );
    }

    #[test]
    fn build_git_command_unbound_sets_neither_current_dir_nor_git_dir() {
        // Unbound is for invocations that target no pre-existing
        // repository, e.g. `git clone`. Either form of scoping would be wrong:
        // GIT_DIR pointing at a not-yet-existing repo would fail, and
        // current_dir would silently affect where the new repo lands.
        let cmd = build_git_command(
            GitTarget::Unbound,
            &["clone", "--bare", "https://x/y.git", "y.git"],
        );

        assert!(
            cmd.get_current_dir().is_none(),
            "Unbound target must not set current_dir"
        );

        let git_dir = cmd
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("GIT_DIR"));
        assert!(git_dir.is_none(), "Unbound target must not set GIT_DIR");
    }

    #[test]
    fn build_git_command_forwards_args_in_order() {
        let repo_path = PathBuf::from("/tmp/grove-test/repo.git");
        let cmd = build_git_command(
            GitTarget::BareRepo(&repo_path),
            &["worktree", "list", "--porcelain"],
        );

        let args: Vec<&OsStr> = cmd.get_args().collect();
        assert_eq!(
            args,
            vec![
                OsStr::new("worktree"),
                OsStr::new("list"),
                OsStr::new("--porcelain"),
            ]
        );
    }

    // The two helpers below cover the post-clone steps in
    // `clone_bare_repository`: `git fetch origin` and
    // `git remote set-head origin --auto`. Both run against a bare
    // repository that has just been cloned by `git clone --bare`.
    //
    // They are tested separately (instead of inline in
    // `clone_bare_repository`) because the bug they guard against is a
    // pattern-level bug: a future contributor could re-introduce the
    // `Command::new("git").current_dir(target_dir)` shape, which works
    // under default git config but breaks silently under
    // `safe.bareRepository=explicit`. Asserting the constructed `Command`
    // here means CI catches that regression without needing a real bare
    // repo on disk or a CI runner with `safe.bareRepository=explicit`
    // pre-set.

    #[test]
    fn build_fetch_origin_command_uses_bare_repo_target() {
        let target_dir = "/tmp/grove-test/just-cloned.git";
        let cmd = build_fetch_origin_command(target_dir);

        // GIT_DIR must be set (BareRepo target). The historical bug used
        // current_dir(target_dir) instead, which breaks under
        // safe.bareRepository=explicit because that setting disables
        // git's CWD-based bare-repo discovery.
        let git_dir = cmd
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("GIT_DIR"))
            .and_then(|(_, value)| value);
        assert_eq!(
            git_dir,
            Some(OsStr::new(target_dir)),
            "fetch-origin command must identify the bare repo via GIT_DIR \
             (not via current_dir) so it works under \
             safe.bareRepository=explicit"
        );

        assert!(
            cmd.get_current_dir().is_none(),
            "fetch-origin command must not set current_dir on the bare repo \
             path; that re-enables the safe.bareRepository=explicit failure \
             mode. Got current_dir={:?}",
            cmd.get_current_dir()
        );

        let args: Vec<&OsStr> = cmd.get_args().collect();
        assert_eq!(args, vec![OsStr::new("fetch"), OsStr::new("origin")]);
    }

    #[test]
    fn build_set_head_command_uses_bare_repo_target() {
        let target_dir = "/tmp/grove-test/just-cloned.git";
        let cmd = build_set_head_command(target_dir);

        let git_dir = cmd
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("GIT_DIR"))
            .and_then(|(_, value)| value);
        assert_eq!(
            git_dir,
            Some(OsStr::new(target_dir)),
            "set-head command must identify the bare repo via GIT_DIR \
             (not via current_dir) so it works under \
             safe.bareRepository=explicit"
        );

        assert!(
            cmd.get_current_dir().is_none(),
            "set-head command must not set current_dir on the bare repo \
             path; that re-enables the safe.bareRepository=explicit failure \
             mode. Got current_dir={:?}",
            cmd.get_current_dir()
        );

        let args: Vec<&OsStr> = cmd.get_args().collect();
        assert_eq!(
            args,
            vec![
                OsStr::new("remote"),
                OsStr::new("set-head"),
                OsStr::new("origin"),
                OsStr::new("--auto"),
            ]
        );
    }
}
