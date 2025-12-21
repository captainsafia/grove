import { Command } from "commander";
import chalk from "chalk";
import { WorktreeManager } from "../git/WorktreeManager";
import { Worktree, WorktreeListOptions } from "../models";
import { formatCreatedTime, formatPathWithTilde } from "../utils";

interface ListCommandOptions extends WorktreeListOptions {
  json: boolean;
}

export function createListCommand(): Command {
  const command = new Command("list");

  command
    .alias("ls")
    .description("List all worktrees")
    .option("--details", "Show detailed information", false)
    .option("--dirty", "Show only dirty worktrees", false)
    .option("--locked", "Show only locked worktrees", false)
    .option("--json", "Output in JSON format", false)
    .action(async (options: ListCommandOptions) => {
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

async function runList(options: ListCommandOptions): Promise<void> {
  const manager = new WorktreeManager();
  await manager.initialize();

  let foundAny = false;
  let matchedAny = false;

  // Handle JSON output - needs to collect all data first
  if (options.json) {
    const worktrees: Worktree[] = [];
    
    for await (const worktree of manager.streamWorktrees()) {
      foundAny = true;

      // Apply filters
      if (options.dirty && !worktree.isDirty) {
        continue;
      }
      if (options.locked && !worktree.isLocked) {
        continue;
      }

      worktrees.push(worktree);
    }

    const jsonOutput = worktrees.map(wt => ({
      path: wt.path,
      branch: wt.branch,
      head: wt.head,
      createdAt: wt.createdAt.toISOString(),
      isDirty: wt.isDirty,
      isLocked: wt.isLocked,
      isPrunable: wt.isPrunable,
      isMain: wt.isMain,
    }));
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }

  // Show legend for non-JSON output
  console.log(chalk.gray("Legend: ") + chalk.green("green") + chalk.gray(" = clean, ") + chalk.yellow("yellow") + chalk.gray(" = dirty"));
  if (options.details) {
    console.log(chalk.gray("Symbols: 🔒 = locked, ⚠ = prunable"));
  }
  console.log();

  // Stream and print worktrees as they come in
  for await (const worktree of manager.streamWorktrees()) {
    foundAny = true;

    // Apply filters
    if (options.dirty && !worktree.isDirty) {
      continue;
    }
    if (options.locked && !worktree.isLocked) {
      continue;
    }

    matchedAny = true;
    printWorktreeItem(worktree, options);
  }

  if (!foundAny) {
    console.log(chalk.yellow("No worktrees found."));
  } else if (!matchedAny) {
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

  // Calculate widths based on terminal size
  const terminalWidth = process.stdout.columns || 80;

  // Allocate: 50% for path, 30% for branch, 20% for time
  const pathWidth = Math.max(20, Math.floor(terminalWidth * 0.5));
  const branchWidth = Math.max(15, Math.floor(terminalWidth * 0.3));

  // Truncate path if too long
  const truncatedPath = displayPath.length > pathWidth
    ? '...' + displayPath.slice(-(pathWidth - 3))
    : displayPath;

  const pathSpacing = ' '.repeat(Math.max(0, pathWidth - truncatedPath.length));
  const branchText = `[${worktree.branch}]${symbols}`;
  const branchSpacing = ' '.repeat(Math.max(0, branchWidth - branchText.length));

  console.log(`${truncatedPath}${pathSpacing}  ${branchDisplay}${symbols}${branchSpacing}  ${chalk.gray(createdStr)}`);

  // Show additional details if requested
  if (options.details) {
    const headShort = worktree.head.length > 8 ? worktree.head.substring(0, 8) : worktree.head;
    console.log(`  ${chalk.gray('→')} ${chalk.gray(headShort)}`);
  }
}
