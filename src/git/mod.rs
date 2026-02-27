pub mod worktree_manager;

pub use worktree_manager::{
    add_worktree, branch_exists, clone_bare_repository, discover_repo, find_worktree_by_name,
    get_default_branch, is_branch_merged, list_worktrees, project_root, remove_worktree,
    remove_worktrees, repo_path, sync_branch, RepoContext, DETACHED_HEAD,
};
