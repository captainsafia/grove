import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
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

  const worktrees = await manager.listWorktrees();

  const filteredWorktrees = filterWorktrees(worktrees, options);

  if (filteredWorktrees.length === 0) {
    console.log(chalk.yellow("No worktrees found matching the criteria."));
    return;
  }

  printWorktrees(filteredWorktrees, options);
}

function filterWorktrees(
  worktrees: Worktree[],
  options: WorktreeListOptions,
): Worktree[] {
  return worktrees.filter((wt) => {
    if (options.dirty && !wt.isDirty) {
      return false;
    }
    if (options.locked && !wt.isLocked) {
      return false;
    }
    return true;
  });
}

function printWorktrees(
  worktrees: Worktree[],
  options: WorktreeListOptions,
): void {
  const headers = options.details
    ? ["PATH", "BRANCH", "HEAD", "CREATED", "STATUS"]
    : ["PATH", "BRANCH", "CREATED", "STATUS"];

  const table = new Table({
    head: headers.map((h) => chalk.bold(h)),
    style: { head: [], border: ["gray"] },
  });

  for (const wt of worktrees) {
    const status = formatStatus(wt);
    const createdStr = formatCreatedTime(wt.createdAt);
    const branch = wt.isMain ? chalk.green(`${wt.branch} (main)`) : wt.branch;

    const row = [wt.path, branch, createdStr, status];

    if (options.details) {
      const headShort = wt.head.length > 8 ? wt.head.substring(0, 8) : wt.head;
      row.splice(2, 0, chalk.gray(headShort)); // Insert HEAD between BRANCH and CREATED
    }

    table.push(row);
  }

  console.log(table.toString());
}

function formatStatus(wt: Worktree): string {
  const statuses: string[] = [];

  if (wt.isDirty) {
    statuses.push(chalk.yellow("dirty"));
  }
  if (wt.isLocked) {
    statuses.push(chalk.red("locked"));
  }
  if (wt.isPrunable) {
    statuses.push(chalk.blue("prunable"));
  }

  if (statuses.length === 0) {
    return chalk.green("clean");
  }

  return statuses.join(", ");
}
