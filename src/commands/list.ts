import { Command } from "commander";
import chalk from "chalk";
import { WorktreeManager } from "../git/WorktreeManager";
import { Worktree, WorktreeListOptions } from "../models";
import { formatCreatedTime, formatPathWithTilde } from "../utils";

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

  // Show legend
  console.log(chalk.gray("Legend: ") + chalk.green("green") + chalk.gray(" = clean, ") + chalk.yellow("yellow") + chalk.gray(" = dirty"));
  if (options.details) {
    console.log(chalk.gray("Symbols: 🔒 = locked, ⚠ = prunable"));
  }
  console.log();

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
  // Format inspired by git worktree list:
  // /path/to/worktree  [branch-name]  created-time
  // Colors: green = clean, yellow = dirty
  
  const displayPath = formatPathWithTilde(worktree.path);
  
  // Color the branch based on dirty status
  let branchDisplay = worktree.branch;
  if (worktree.isDirty) {
    branchDisplay = chalk.yellow(`[${branchDisplay}]`);
  } else {
    branchDisplay = chalk.green(`[${branchDisplay}]`);
  }
  
  // Add status symbols after branch
  let symbols = "";
  if (worktree.isLocked) {
    symbols += " 🔒";
  }
  if (worktree.isPrunable) {
    symbols += " ⚠";
  }
  
  const createdStr = formatCreatedTime(worktree.createdAt);
  
  // Format: path  [branch]  time
  // Calculate padding manually since we have colored text
  const pathWidth = 50;
  const branchWidth = 30;
  
  const pathSpacing = ' '.repeat(Math.max(0, pathWidth - displayPath.length));
  const branchText = `[${worktree.branch}]${symbols}`;
  const branchSpacing = ' '.repeat(Math.max(0, branchWidth - branchText.length));
  
  console.log(`${displayPath}${pathSpacing}  ${branchDisplay}${symbols}${branchSpacing}  ${chalk.gray(createdStr)}`);
  
  // Show additional details if requested
  if (options.details) {
    const headShort = worktree.head.length > 8 ? worktree.head.substring(0, 8) : worktree.head;
    console.log(`  ${chalk.gray('→')} ${chalk.gray(headShort)}`);
  }
}
