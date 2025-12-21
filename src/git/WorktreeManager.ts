import { SimpleGit, simpleGit } from "simple-git";
import * as fs from "fs";
import * as path from "path";
import { Worktree, PruneOptions } from "../models";

// Constants
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds for standard operations
const CLONE_TIMEOUT_MS = 300000; // 5 minutes for clone operations
export const MAIN_BRANCHES = ['main', 'master'] as const;
export const DETACHED_HEAD = 'detached HEAD';

export class WorktreeManager {
  private git: SimpleGit;
  private repoPath: string;
  private isBare: boolean;

  constructor(repoPath?: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.repoPath = repoPath || process.cwd();
    this.git = simpleGit({
      baseDir: this.repoPath,
      timeout: { block: timeoutMs },
    });
    this.isBare = false;
  }

  async initialize(): Promise<void> {
    try {
      // Check if it's a bare repository first
      this.isBare = await this.checkIfBare();

      if (!this.isBare) {
        // Only check status for non-bare repositories
        await this.git.status();
      } else {
        // For bare repositories, just verify we can access git commands
        await this.git.raw(["rev-parse", "--git-dir"]);
      }
    } catch (error) {
      throw new Error(`Not in a git repository: ${error}`);
    }
  }

  private async checkIfBare(): Promise<boolean> {
    try {
      const configResult = await this.git.raw(["config", "--get", "core.bare"]);
      return configResult.trim() === "true";
    } catch {
      // If config fails, check for bare repo structure
      const headPath = path.join(this.repoPath, "HEAD");
      const refsPath = path.join(this.repoPath, "refs");
      const objectsPath = path.join(this.repoPath, "objects");

      return (
        fs.existsSync(headPath) &&
        fs.existsSync(refsPath) &&
        fs.existsSync(objectsPath)
      );
    }
  }

  async listWorktrees(): Promise<Worktree[]> {
    try {
      const result = await this.git.raw(["worktree", "list", "--porcelain"]);
      return this.parseWorktreeList(result);
    } catch (error) {
      throw new Error(`Failed to list worktrees: ${error}`);
    }
  }

  async *streamWorktrees(): AsyncGenerator<Worktree, void, unknown> {
    try {
      const result = await this.git.raw(["worktree", "list", "--porcelain"]);

      for (const partialWorktree of this.parseWorktreeLines(result)) {
        const completedWorktree = await this.completeWorktreeInfo(partialWorktree as Worktree);
        yield completedWorktree;
      }
    } catch (error) {
      throw new Error(`Failed to list worktrees: ${error}`);
    }
  }

  private async parseWorktreeList(output: string): Promise<Worktree[]> {
    const worktrees: Worktree[] = [];

    for (const partialWorktree of this.parseWorktreeLines(output)) {
      worktrees.push(
        await this.completeWorktreeInfo(partialWorktree as Worktree),
      );
    }

    return worktrees;
  }

  private *parseWorktreeLines(output: string): Generator<Partial<Worktree>, void, unknown> {
    const lines = output.trim().split("\n");

    let currentWorktree: Partial<Worktree> = {};
    let isBare = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        if (currentWorktree.path && !isBare) {
          yield currentWorktree;
        }
        currentWorktree = { path: line.substring(9) };
        isBare = false;
      } else if (line.startsWith("HEAD ")) {
        currentWorktree.head = line.substring(5);
      } else if (line.startsWith("branch ")) {
        currentWorktree.branch = line.substring(7).replace("refs/heads/", "");
      } else if (line === "detached") {
        currentWorktree.branch = DETACHED_HEAD;
      } else if (line === "locked") {
        currentWorktree.isLocked = true;
      } else if (line === "prunable") {
        currentWorktree.isPrunable = true;
      } else if (line === "bare") {
        isBare = true;
      }
    }

    if (currentWorktree.path && !isBare) {
      yield currentWorktree;
    }
  }

  private async completeWorktreeInfo(worktree: Worktree): Promise<Worktree> {
    // Set defaults
    worktree.isDirty = false;
    worktree.isLocked = worktree.isLocked || false;
    worktree.isPrunable = worktree.isPrunable || false;
    worktree.isMain = false;
    worktree.createdAt = new Date(0); // Default to epoch

    try {
      // Check if worktree is dirty
      const git = simpleGit(worktree.path);
      const status = await git.status();
      worktree.isDirty = !status.isClean();

      // Check if this is the main branch
      worktree.isMain = (MAIN_BRANCHES as readonly string[]).includes(worktree.branch);

      // Try to get creation time from filesystem
      try {
        const stats = fs.statSync(worktree.path);
        worktree.createdAt = stats.birthtime || stats.ctime;
      } catch {
        // If we can't get filesystem time, use current time
        worktree.createdAt = new Date();
      }
    } catch (error) {
      // If we can't access the worktree, mark it as potentially prunable
      console.warn(
        `Warning: Could not access worktree ${worktree.path}: ${error}`,
      );
    }

    return worktree;
  }

  async branchExists(branch: string): Promise<boolean> {
    try {
      await this.git.raw(["rev-parse", "--verify", `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  async isBranchMerged(branch: string, baseBranch: string): Promise<boolean> {
    try {
      // First, check for regular merges using git branch --merged
      const result = await this.git.raw(["branch", "--merged", baseBranch]);
      const mergedBranches = result
        .split("\n")
        .map((line) => line.trim().replace(/^\*?\s*/, ""))
        .filter((line) => line);

      if (mergedBranches.includes(branch)) {
        return true;
      }

      // Check for squash merges by comparing the files changed by the branch
      // If all files the branch touched are identical to the base, it was squash-merged
      return await this.isSquashMerged(branch, baseBranch);
    } catch (error) {
      throw new Error(
        `Failed to check if branch ${branch} is merged: ${error}`,
      );
    }
  }

  private async isSquashMerged(branch: string, baseBranch: string): Promise<boolean> {
    try {
      // Get files the branch changed (from merge-base to branch tip)
      // Uses three-dot syntax which is equivalent to diff against merge-base
      const branchFiles = await this.git.raw([
        "diff",
        "--name-only",
        `${baseBranch}...${branch}`,
      ]);

      const files = branchFiles.trim().split("\n").filter((f) => f);
      if (files.length === 0) {
        return true;
      }

      // Check if those specific files are identical between branch and base
      const diff = await this.git.raw([
        "diff",
        "--name-only",
        baseBranch,
        branch,
        "--",
        ...files,
      ]);

      return diff.trim() === "";
    } catch {
      return false;
    }
  }

  async pruneWorktrees(options: PruneOptions): Promise<void> {
    const worktrees = await this.listWorktrees();

    for (const worktree of worktrees) {
      if (worktree.isMain || worktree.isLocked) {
        continue;
      }

      if (worktree.branch === DETACHED_HEAD) {
        continue;
      }

      try {
        let shouldPrune = false;

        // If olderThan is provided, skip merge check and only check age
        if (options.olderThan) {
          const cutoffTime = new Date(Date.now() - options.olderThan);
          shouldPrune = worktree.createdAt.getTime() !== 0 && worktree.createdAt <= cutoffTime;
        } else {
          // Check if branch is merged
          const isMerged = await this.isBranchMerged(
            worktree.branch,
            options.baseBranch,
          );
          shouldPrune = isMerged;
        }

        if (shouldPrune && (options.force || !worktree.isDirty)) {
          console.log(`Pruning worktree: ${worktree.path}`);

          if (!options.dryRun) {
            const removeArgs = ["worktree", "remove"];
            if (options.force) {
              removeArgs.push("--force");
            }
            removeArgs.push(worktree.path);
            await this.git.raw(removeArgs);
            console.log(`✓ Removed worktree: ${worktree.path}`);
          } else {
            console.log(`Would remove worktree: ${worktree.path}`);
          }
        }
      } catch (error) {
        console.warn(
          `Warning: Could not process worktree ${worktree.path}: ${error}`,
        );
      }
    }
  }

  async removeWorktrees(worktrees: Worktree[], force: boolean = false): Promise<{ removed: string[], failed: Array<{ path: string, error: string }> }> {
    const removed: string[] = [];
    const failed: Array<{ path: string, error: string }> = [];

    for (const worktree of worktrees) {
      try {
        const removeArgs = ["worktree", "remove"];
        if (force) {
          removeArgs.push("--force");
        }
        removeArgs.push(worktree.path);
        await this.git.raw(removeArgs);
        removed.push(worktree.path);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        failed.push({ path: worktree.path, error: errorMessage });
      }
    }

    return { removed, failed };
  }

  async cloneBareRepository(gitUrl: string, targetDir: string): Promise<void> {
    try {
      // Use a longer timeout for clone operations
      const cloneGit = simpleGit({ timeout: { block: CLONE_TIMEOUT_MS } });
      await cloneGit.clone(gitUrl, targetDir, ["--bare"]);

      // Configure fetch refspec
      const bareGit = simpleGit({
        baseDir: targetDir,
        timeout: { block: DEFAULT_TIMEOUT_MS },
      });
      await bareGit.addConfig(
        "remote.origin.fetch",
        "+refs/heads/*:refs/remotes/origin/*",
      );
    } catch (error) {
      throw new Error(`Failed to clone repository: ${error}`);
    }
  }

  async addWorktree(
    worktreePath: string,
    branchName: string,
    options: { createBranch?: boolean; track?: string } = {},
  ): Promise<void> {
    try {
      const args = ["worktree", "add"];

      if (options.createBranch) {
        args.push("-b", branchName);
        if (options.track) {
          args.push("--track", options.track);
        }
        args.push(worktreePath);
        if (options.track) {
          args.push(options.track);
        }
      } else {
        args.push(worktreePath, branchName);
      }

      await this.git.raw(args);
    } catch (error) {
      throw new Error(`Failed to add worktree: ${error}`);
    }
  }

  async removeWorktree(worktreePath: string, force: boolean = false): Promise<void> {
    try {
      const args = ["worktree", "remove"];
      if (force) {
        args.push("--force");
      }
      args.push(worktreePath);
      await this.git.raw(args);
    } catch (error) {
      throw new Error(`Failed to remove worktree: ${error}`);
    }
  }

  async getDefaultBranch(): Promise<string> {
    try {
      // Try to get the default branch from the remote HEAD
      const result = await this.git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"]);
      const branch = result.trim().replace("refs/remotes/origin/", "");
      return branch;
    } catch {
      // Fallback: check if main or master exists
      if (await this.branchExists("main")) {
        return "main";
      }
      if (await this.branchExists("master")) {
        return "master";
      }
      throw new Error("Could not determine default branch. Please specify with --branch.");
    }
  }

  async syncBranch(branch: string): Promise<void> {
    try {
      // Fetch the branch from origin and update the local reference
      // Using git fetch origin <branch>:<branch> to update the local branch
      await this.git.raw(["fetch", "origin", `${branch}:${branch}`]);
    } catch (error) {
      throw new Error(`Failed to sync branch '${branch}': ${error}`);
    }
  }

  async findWorktreeByName(name: string): Promise<Worktree | undefined> {
    const worktrees = await this.listWorktrees();

    // First, try exact branch name match
    let worktree = worktrees.find((wt) => wt.branch === name);
    if (worktree) {
      return worktree;
    }

    // Try matching by directory name (last part of the path)
    worktree = worktrees.find((wt) => {
      const dirName = path.basename(wt.path);
      return dirName === name;
    });
    if (worktree) {
      return worktree;
    }

    // Try partial branch name match (suffix matching for nested branches like feature/foo)
    worktree = worktrees.find((wt) => wt.branch.endsWith(`/${name}`));
    if (worktree) {
      return worktree;
    }

    return undefined;
  }
}
