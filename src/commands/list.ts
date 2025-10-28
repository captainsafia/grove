import { Command } from "commander";
import chalk from "chalk";
import { WorktreeManager } from "../git/WorktreeManager";
import { Worktree, WorktreeListOptions } from "../models";
import { formatCreatedTime } from "../utils";

export function createListCommand(): Command {
  const command = new Command("list");

  command
    .description("List all worktrees")
    .option("--details", "Show detailed information", false)
    .option("--dirty", "Show only dirty worktrees", false)
    .option("--locked", "Show only locked worktrees", false)
    .action(async (options: WorktreeListOptions) => {
      try {
        await runList(options);
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

async function runList(options: WorktreeListOptions): Promise<void> {
  const manager = new WorktreeManager();
  await manager.initialize();

  let foundAny = false;
  let matchingCount = 0;

  // Show legend if details are requested
  if (options.details) {
    console.log(chalk.gray("Legend: ● dirty, 🔒 locked, ⚠ prunable"));
    console.log();
  }

  // Stream worktrees and display each one as it's processed
  for await (const worktree of manager.streamWorktrees()) {
    foundAny = true;

    // Apply filters
    if (options.dirty && !worktree.isDirty) {
      continue;
    }
    if (options.locked && !worktree.isLocked) {
      continue;
    }

    // Display this worktree immediately
    printWorktreeItem(worktree, options);
    matchingCount++;

    // Flush stdout to ensure immediate display
    process.stdout.write('');
  }

  if (!foundAny) {
    console.log(chalk.yellow("No worktrees found."));
  } else if (matchingCount === 0) {
    console.log(chalk.yellow("No worktrees found matching the criteria."));
  }
}

function printWorktreeItem(worktree: Worktree, options: WorktreeListOptions): void {
  // Format: (branch●) directory [created-time] 
  // Symbols: ● = dirty, 🔒 = locked, ⚠ = prunable
  // Colors: green = main branch, yellow = dirty branch, red = locked branch, cyan = regular branch
  
  let branchDisplay = worktree.branch;
  let symbols = "";
  
  // Add status symbols
  if (worktree.isDirty) {
    symbols += "●";
  }
  if (worktree.isLocked) {
    symbols += "🔒";
  }
  if (worktree.isPrunable) {
    symbols += "⚠";
  }
  
  // Color the branch based on status
  if (worktree.isMain) {
    branchDisplay = chalk.green(branchDisplay);
  } else if (worktree.isDirty) {
    branchDisplay = chalk.yellow(branchDisplay);
  } else if (worktree.isLocked) {
    branchDisplay = chalk.red(branchDisplay);
  } else {
    branchDisplay = chalk.cyan(branchDisplay);
  }
  
  const createdStr = formatCreatedTime(worktree.createdAt);
  const timeDisplay = chalk.gray(`[${createdStr}]`);
  
  // Format: (branch●) path [time]
  console.log(`(${branchDisplay}${chalk.red(symbols)}) ${worktree.path} ${timeDisplay}`);
  
  // Show additional details if requested
  if (options.details) {
    const headShort = worktree.head.length > 8 ? worktree.head.substring(0, 8) : worktree.head;
    console.log(`  ${chalk.gray('→')} ${chalk.gray(headShort)}`);
  }
}
