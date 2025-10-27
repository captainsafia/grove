export interface Worktree {
  path: string;
  branch: string;
  head: string;
  createdAt: Date;
  isDirty: boolean;
  isLocked: boolean;
  isPrunable: boolean;
  isMain: boolean;
}

export interface WorktreeListOptions {
  dirty: boolean;
  locked: boolean;
  details: boolean;
}

export interface PruneOptions {
  dryRun: boolean;
  force: boolean;
  baseBranch: string;
  olderThan?: number; // Age threshold in milliseconds
}

export interface InitOptions {
  gitUrl: string;
}
