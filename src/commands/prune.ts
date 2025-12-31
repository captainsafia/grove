import { Command } from "commander";
import chalk from "chalk";
import confirm from "@inquirer/confirm";
import { WorktreeManager, DETACHED_HEAD } from "../git/WorktreeManager";
import { Worktree, PruneOptions } from "../models";
import { parseDuration, handleCommandError } from "../utils";

interface PruneCommandOptions {
  dryRun: boolean;
  force: boolean;
  base?: string;
  olderThan?: string;
}

export function createPruneCommand(): Command {
  const command = new Command("prune");

  command
    .description("Remove worktrees for merged branches")
    .option(
      "--dry-run",
      "Show what would be removed without actually removing",
      false,
    )
    .option(
      "-f, --force",
      "Skip confirmation and remove worktrees even with uncommitted changes",
      false,
    )
    .option(
      "--base <branch>",
      "Base branch to check for merged branches (ignored when --older-than is used)",
    )
    .option(
      "--older-than <duration>",
      "Prune worktrees older than specified duration, bypassing merge check (e.g., 30d, 2w, 6M, 1y, or ISO 8601 like P30D, P1Y)",
    )
    .action(async (options: PruneCommandOptions) => {
      try {
        await runPrune(options);
      } catch (error) {
        handleCommandError(error);
      }
    });

  return command;
}

async function runPrune(options: PruneCommandOptions): Promise<void> {
  // Validate options
  if (options.olderThan && options.base) {
    throw new Error(
      "--base and --older-than cannot be used together (--base is ignored when --older-than is specified)",
    );
  }

  // Parse the older-than duration if provided
  let ageThresholdMs = 0;
  let cutoffTime = new Date(0);
  if (options.olderThan) {
    ageThresholdMs = parseDuration(options.olderThan);
    cutoffTime = new Date(Date.now() - ageThresholdMs);
  }

  // Use discovery to find the bare clone from anywhere in the project hierarchy
  const manager = await WorktreeManager.discover();

  // Get the base branch (use default if not specified and not using --older-than)
  let baseBranch = options.base;
  if (!options.olderThan && !baseBranch) {
    baseBranch = await manager.getDefaultBranch();
  }

  const worktrees = await manager.listWorktrees();
  const candidatesForPruning: Worktree[] = [];

  for (const wt of worktrees) {
    if (wt.isMain || wt.isLocked) {
      continue;
    }

    if (wt.branch === DETACHED_HEAD) {
      continue;
    }

    if (baseBranch && wt.branch === baseBranch) {
      continue;
    }

    // If --older-than is specified, only filter by age (skip merge check)
    if (options.olderThan) {
      if (wt.createdAt.getTime() === 0 || wt.createdAt > cutoffTime) {
        continue;
      }
      candidatesForPruning.push(wt);
    } else {
      try {
        const isMerged = await manager.isBranchMerged(wt.branch, baseBranch!);
        if (isMerged) {
          candidatesForPruning.push(wt);
        }
      } catch (error) {
        if (!options.dryRun) {
          console.warn(
            chalk.yellow(
              `Warning: Could not check merge status for branch '${wt.branch}': ${error}`,
            ),
          );
        }
      }
    }
  }

  if (candidatesForPruning.length === 0) {
    if (options.olderThan) {
      console.log(
        chalk.yellow("No worktrees found older than the specified duration."),
      );
    } else {
      console.log(chalk.yellow("No worktrees found with merged branches."));
    }
    return;
  }

  if (options.olderThan) {
    console.log(
      chalk.green(
        `Found ${candidatesForPruning.length} worktree(s) older than ${options.olderThan}:`,
      ),
    );
  } else {
    console.log(
      chalk.green(
        `Found ${candidatesForPruning.length} worktree(s) with merged branches:`,
      ),
    );
  }
  console.log();

  for (const wt of candidatesForPruning) {
    const status = getWorktreeStatus(wt);

    console.log(chalk.bold(`  ${wt.path}`));
    console.log(chalk.gray(`    Branch: ${wt.branch}`));
    console.log(chalk.gray(`    Status: ${status}`));
    if (wt.createdAt.getTime() !== 0) {
      console.log(
        chalk.gray(
          `    Created: ${wt.createdAt.toISOString().split("T")[0]}`,
        ),
      );
    }
    console.log();
  }

  if (options.dryRun) {
    console.log(
      chalk.blue(
        "This was a dry run. Remove --dry-run flag to actually remove the worktrees.",
      ),
    );
    return;
  }

  if (!options.force) {
    const dirtyCount = candidatesForPruning.filter((wt) => wt.isDirty).length;
    const confirmMessage = dirtyCount > 0
      ? `Remove ${candidatesForPruning.length} worktree(s)? ${dirtyCount} ${dirtyCount === 1 ? "has" : "have"} uncommitted changes that will be lost.`
      : `Remove ${candidatesForPruning.length} worktree(s)?`;

    const proceed = await confirm({
      message: confirmMessage,
      default: false,
    });

    if (!proceed) {
      console.log(chalk.blue("Operation cancelled."));
      return;
    }
  }

  console.log(chalk.blue("\nRemoving worktrees..."));

  const result = await manager.removeWorktrees(candidatesForPruning, true);

  for (const path of result.removed) {
    console.log(chalk.green(`✓ Removed worktree: ${path}`));
  }

  for (const failure of result.failed) {
    console.log(chalk.red(`✗ Failed to remove ${failure.path}: ${failure.error}`));
  }

  if (result.removed.length > 0) {
    console.log(chalk.green(`\nPrune operation completed. Removed ${result.removed.length} worktree(s).`));
  }

  if (result.failed.length > 0) {
    console.log(chalk.yellow(`\nFailed to remove ${result.failed.length} worktree(s).`));
  }
}

function getWorktreeStatus(wt: Worktree): string {
  const statuses: string[] = [];

  if (wt.isDirty) {
    statuses.push("dirty");
  }
  if (wt.isPrunable) {
    statuses.push("prunable");
  }

  return statuses.length > 0 ? statuses.join(", ") : "clean";
}
