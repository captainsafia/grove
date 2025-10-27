import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { WorktreeManager } from "../git/WorktreeManager";
import { Worktree, PruneOptions } from "../models";
import { parseDuration } from "../utils";

interface PruneCommandOptions {
  dryRun: boolean;
  force: boolean;
  base: string;
  yes: boolean;
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
      "--force",
      "Remove worktrees even if they have uncommitted changes",
      false,
    )
    .option(
      "--base <branch>",
      "Base branch to check for merged branches (ignored when --older-than is used)",
      "main",
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .option(
      "--older-than <duration>",
      "Prune worktrees older than specified duration, bypassing merge check (use ISO 8601 format like P30D, P1Y, P2W, PT1H)",
    )
    .action(async (options: PruneCommandOptions) => {
      try {
        await runPrune(options);
      } catch (error) {
        console.error(
          chalk.red("Error:"),
          error instanceof Error ? error.message : error,
        );
        process.exit(1);
      }
    });

  return command;
}

async function runPrune(options: PruneCommandOptions): Promise<void> {
  // Validate options
  if (options.olderThan && options.base !== "main") {
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

  const manager = new WorktreeManager();
  await manager.initialize();

  const worktrees = await manager.listWorktrees();
  const candidatesForPruning: Worktree[] = [];

  if (options.olderThan) {
    console.log(
      chalk.blue(`Checking for worktrees older than ${options.olderThan}...`),
    );
  } else {
    console.log(
      chalk.blue(
        `Checking for worktrees with branches merged into '${options.base}'...`,
      ),
    );
  }
  console.log();

  for (const wt of worktrees) {
    if (wt.isMain || wt.isLocked) {
      continue;
    }

    if (wt.branch === "detached HEAD") {
      continue;
    }

    if (options.base && wt.branch.includes(options.base)) {
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
        const isMerged = await manager.isBranchMerged(wt.branch, options.base);
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
    if (dirtyCount > 0) {
      console.log(
        chalk.yellow(
          `Warning: ${dirtyCount} worktree(s) have uncommitted changes.`,
        ),
      );
      console.log(
        chalk.yellow(
          "Use --force to remove them anyway, or commit/stash your changes first.",
        ),
      );
      console.log();
    }
  }

  if (!options.yes) {
    const answers = await inquirer.prompt([
      {
        type: "confirm",
        name: "proceed",
        message: "Do you want to proceed with removing these worktrees?",
        default: false,
      },
    ]);

    if (!answers.proceed) {
      console.log(chalk.blue("Operation cancelled."));
      return;
    }
  }

  const pruneOptions: PruneOptions = {
    dryRun: false,
    force: options.force,
    baseBranch: options.base,
    olderThan: options.olderThan ? ageThresholdMs : undefined,
  };

  console.log(chalk.blue("\nRemoving worktrees..."));
  await manager.pruneWorktrees(pruneOptions);
  console.log(chalk.green("\nPrune operation completed."));
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
