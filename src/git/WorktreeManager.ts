import { SimpleGit, simpleGit } from "simple-git";
import * as fs from "fs";
import * as path from "path";
import { Worktree, PruneOptions } from "../models";

export class WorktreeManager {
  private git: SimpleGit;
  private repoPath: string;
  private isBare: boolean;

  constructor(repoPath?: string) {
    this.repoPath = repoPath || process.cwd();
    this.git = simpleGit(this.repoPath);
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
      const lines = result.trim().split("\n");

      let currentWorktree: Partial<Worktree> = {};
      let isBare = false;

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          if (currentWorktree.path && !isBare) {
            const completedWorktree = await this.completeWorktreeInfo(currentWorktree as Worktree);
            yield completedWorktree;
          }
          currentWorktree = { path: line.substring(9) };
          isBare = false; // Reset for new worktree
        } else if (line.startsWith("HEAD ")) {
          currentWorktree.head = line.substring(5);
        } else if (line.startsWith("branch ")) {
          currentWorktree.branch = line.substring(7).replace("refs/heads/", "");
        } else if (line === "detached") {
          currentWorktree.branch = "detached HEAD";
        } else if (line === "locked") {
          currentWorktree.isLocked = true;
        } else if (line === "prunable") {
          currentWorktree.isPrunable = true;
        } else if (line === "bare") {
          isBare = true;
        }
      }

      if (currentWorktree.path && !isBare) {
        const completedWorktree = await this.completeWorktreeInfo(currentWorktree as Worktree);
        yield completedWorktree;
      }
    } catch (error) {
      throw new Error(`Failed to list worktrees: ${error}`);
    }
  }

  private async parseWorktreeList(output: string): Promise<Worktree[]> {
    const worktrees: Worktree[] = [];
    const lines = output.trim().split("\n");

    let currentWorktree: Partial<Worktree> = {};
    let isBare = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        if (currentWorktree.path && !isBare) {
          worktrees.push(
            await this.completeWorktreeInfo(currentWorktree as Worktree),
          );
        }
        currentWorktree = { path: line.substring(9) };
        isBare = false; // Reset for new worktree
      } else if (line.startsWith("HEAD ")) {
        currentWorktree.head = line.substring(5);
      } else if (line.startsWith("branch ")) {
        currentWorktree.branch = line.substring(7).replace("refs/heads/", "");
      } else if (line === "detached") {
        currentWorktree.branch = "detached HEAD";
      } else if (line === "locked") {
        currentWorktree.isLocked = true;
      } else if (line === "prunable") {
        currentWorktree.isPrunable = true;
      } else if (line === "bare") {
        isBare = true;
      }
    }

    if (currentWorktree.path && !isBare) {
      worktrees.push(
        await this.completeWorktreeInfo(currentWorktree as Worktree),
      );
    }

    return worktrees;
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
      const mainBranches = ["main", "master"];
      worktree.isMain = mainBranches.includes(worktree.branch);

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

  async isBranchMerged(branch: string, baseBranch: string): Promise<boolean> {
    try {
      const result = await this.git.raw(["branch", "--merged", baseBranch]);
      const mergedBranches = result
        .split("\n")
        .map((line) => line.trim().replace(/^\*?\s*/, ""))
        .filter((line) => line);

      return mergedBranches.includes(branch);
    } catch (error) {
      throw new Error(
        `Failed to check if branch ${branch} is merged: ${error}`,
      );
    }
  }

  async pruneWorktrees(options: PruneOptions): Promise<void> {
    const worktrees = await this.listWorktrees();

    for (const worktree of worktrees) {
      if (worktree.isMain || worktree.isLocked) {
        continue;
      }

      if (worktree.branch === "detached HEAD") {
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

  async cloneBareRepository(gitUrl: string, targetDir: string): Promise<void> {
    try {
      await this.git.clone(gitUrl, targetDir, ["--bare"]);

      // Configure fetch refspec
      const bareGit = simpleGit(targetDir);
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
}
