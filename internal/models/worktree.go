package models

import "time"

type Worktree struct {
	Path         string
	Branch       string
	Head         string
	CreatedAt    time.Time
	IsDirty      bool
	IsLocked     bool
	IsPrunable   bool
	IsMain       bool
}

type WorktreeListOptions struct {
	ShowDirty   bool
	ShowLocked  bool
	ShowDetails bool
}

type PruneOptions struct {
	DryRun      bool
	Force       bool
	BaseBranch  string
}