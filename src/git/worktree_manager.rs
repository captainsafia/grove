use chrono::{DateTime, TimeZone, Utc};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::models::Worktree;
use crate::utils::{discover_bare_clone, get_project_root};

pub const MAIN_BRANCHES: &[&str] = &["main", "master"];
pub const DETACHED_HEAD: &str = "detached HEAD";

pub struct WorktreeManager {
    repo_path: PathBuf,
    project_root: Option<PathBuf>,
}

impl WorktreeManager {
    pub fn new(repo_path: Option<&Path>) -> Self {
        let path = repo_path
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        WorktreeManager {
            repo_path: path,
            project_root: None,
        }
    }

    /// Static factory method that discovers the grove repository and returns an initialized WorktreeManager.
    pub fn discover() -> Result<Self, String> {
        let bare_clone_path = discover_bare_clone(None)
            .map_err(|e| e.message)?;

        let project_root = get_project_root(&bare_clone_path);

        // Cache the discovered path
        env::set_var("GROVE_REPO", &bare_clone_path);

        Ok(WorktreeManager {
            repo_path: bare_clone_path,
            project_root: Some(project_root),
        })
    }

    pub fn get_project_root(&self) -> PathBuf {
        self.project_root
            .clone()
            .unwrap_or_else(|| {
                self.repo_path
                    .parent()
                    .unwrap_or(Path::new("/"))
                    .to_path_buf()
            })
    }

    pub fn get_repo_path(&self) -> &Path {
        &self.repo_path
    }

    fn git_raw(&self, args: &[&str]) -> Result<String, String> {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| format!("Failed to execute git: {}", e))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(stderr.trim().to_string())
        }
    }

    pub fn list_worktrees(&self) -> Result<Vec<Worktree>, String> {
        let result = self
            .git_raw(&["worktree", "list", "--porcelain"])
            .map_err(|e| format!("Failed to list worktrees: {}", e))?;

        let partials = parse_worktree_lines(&result);
        let mut worktrees = Vec::new();
        for partial in partials {
            worktrees.push(complete_worktree_info(partial));
        }
        Ok(worktrees)
    }

    pub fn branch_exists(&self, branch: &str) -> bool {
        self.git_raw(&["rev-parse", "--verify", &format!("refs/heads/{}", branch)])
            .is_ok()
    }

    pub fn is_branch_merged(&self, branch: &str, base_branch: &str) -> Result<bool, String> {
        // First, check for regular merges
        let result = self
            .git_raw(&["branch", "--merged", base_branch])
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
        self.is_squash_merged(branch, base_branch)
    }

    fn is_squash_merged(&self, branch: &str, base_branch: &str) -> Result<bool, String> {
        let branch_files = self
            .git_raw(&["diff", "--name-only", &format!("{}...{}", base_branch, branch)])
            .unwrap_or_default();

        let files: Vec<&str> = branch_files
            .lines()
            .filter(|f| !f.is_empty())
            .collect();

        if files.is_empty() {
            return Ok(true);
        }

        let mut diff_args = vec!["diff", "--name-only", base_branch, branch, "--"];
        diff_args.extend(files);

        let diff = self.git_raw(&diff_args).unwrap_or_default();
        Ok(diff.trim().is_empty())
    }

    pub fn clone_bare_repository(&self, git_url: &str, target_dir: &str) -> Result<(), String> {
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
        &self,
        worktree_path: &str,
        branch_name: &str,
        create_branch: bool,
        track: Option<&str>,
    ) -> Result<(), String> {
        let mut args = vec!["worktree", "add"];

        if create_branch {
            args.push("-b");
            args.push(branch_name);
            if let Some(track_branch) = track {
                args.push("--track");
                args.push(track_branch);
            }
            args.push(worktree_path);
            if let Some(track_branch) = track {
                args.push(track_branch);
            }
        } else {
            args.push(worktree_path);
            args.push(branch_name);
        }

        self.git_raw(&args)
            .map_err(|e| format!("Failed to add worktree: {}", e))?;
        Ok(())
    }

    pub fn remove_worktree(&self, worktree_path: &str, force: bool) -> Result<(), String> {
        let mut args = vec!["worktree", "remove"];
        if force {
            args.push("--force");
        }
        args.push(worktree_path);

        self.git_raw(&args)
            .map_err(|e| format!("Failed to remove worktree: {}", e))?;
        Ok(())
    }

    pub fn remove_worktrees(
        &self,
        worktrees: &[Worktree],
        force: bool,
    ) -> (Vec<String>, Vec<(String, String)>) {
        let mut removed = Vec::new();
        let mut failed = Vec::new();

        for wt in worktrees {
            match self.remove_worktree(&wt.path, force) {
                Ok(()) => removed.push(wt.path.clone()),
                Err(e) => failed.push((wt.path.clone(), e)),
            }
        }

        (removed, failed)
    }

    pub fn get_default_branch(&self) -> Result<String, String> {
        // Try to get the default branch from the remote HEAD
        if let Ok(result) = self.git_raw(&["symbolic-ref", "refs/remotes/origin/HEAD"]) {
            let branch = result.trim().replace("refs/remotes/origin/", "");
            return Ok(branch);
        }

        // Fallback: check if main or master exists
        if self.branch_exists("main") {
            return Ok("main".to_string());
        }
        if self.branch_exists("master") {
            return Ok("master".to_string());
        }

        Err("Could not determine default branch. Please specify with --branch.".to_string())
    }

    pub fn sync_branch(&self, branch: &str) -> Result<(), String> {
        self.git_raw(&["fetch", "origin", &format!("{}:{}", branch, branch)])
            .map_err(|e| format!("Failed to sync branch '{}': {}", branch, e))?;
        Ok(())
    }

    pub fn find_worktree_by_name(&self, name: &str) -> Result<Option<Worktree>, String> {
        let worktrees = self.list_worktrees()?;

        // First, try exact branch name match
        if let Some(wt) = worktrees.iter().find(|wt| wt.branch == name) {
            return Ok(Some(wt.clone()));
        }

        // Try matching by directory name
        if let Some(wt) = worktrees.iter().find(|wt| {
            Path::new(&wt.path)
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n == name)
                .unwrap_or(false)
        }) {
            return Ok(Some(wt.clone()));
        }

        // Try partial branch name match (suffix matching)
        if let Some(wt) = worktrees
            .iter()
            .find(|wt| wt.branch.ends_with(&format!("/{}", name)))
        {
            return Ok(Some(wt.clone()));
        }

        Ok(None)
    }
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

    // Try to get creation time from filesystem
    let created_at = fs::metadata(&path)
        .ok()
        .and_then(|meta| meta.created().ok())
        .map(|st| {
            let duration = st
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default();
            Utc.timestamp_opt(duration.as_secs() as i64, 0)
                .single()
                .unwrap_or_else(|| DateTime::from_timestamp(0, 0).unwrap())
        })
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

#[cfg(test)]
mod tests {
    use super::*;

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
        let output = "worktree /path/to/master-worktree\nHEAD abc123def456\nbranch refs/heads/master\n";
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
}
