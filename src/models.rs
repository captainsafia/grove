use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Worktree {
    pub path: String,
    pub branch: String,
    pub head: String,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    #[serde(rename = "isDirty")]
    pub is_dirty: bool,
    #[serde(rename = "isLocked")]
    pub is_locked: bool,
    #[serde(rename = "isPrunable")]
    pub is_prunable: bool,
    #[serde(rename = "isMain")]
    pub is_main: bool,
}

pub struct WorktreeListOptions {
    pub dirty: bool,
    pub locked: bool,
    pub details: bool,
}

#[allow(dead_code)]
pub struct PruneOptions {
    pub dry_run: bool,
    pub force: bool,
    pub base_branch: String,
    pub older_than: Option<u64>, // Age threshold in milliseconds
}
