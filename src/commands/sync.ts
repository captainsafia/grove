import { Command } from "commander";
import chalk from "chalk";
import { WorktreeManager } from "../git/WorktreeManager";
import { handleCommandError } from "../utils";

interface SyncCommandOptions {
  branch?: string;
}

export function createSyncCommand(): Command {
  const command = new Command("sync");

  command
    .description("Sync the bare clone with the latest changes from origin")
    .option(
      "-b, --branch <branch>",
      "Branch to sync (defaults to main or master)",
    )
    .action(async (options: SyncCommandOptions) => {
      try {
        await runSync(options);
      } catch (error) {
        handleCommandError(error);
      }
    });

  return command;
}

async function runSync(options: SyncCommandOptions): Promise<void> {
  // Use discovery to find the bare clone from anywhere in the project hierarchy
  const manager = await WorktreeManager.discover();

  // Determine the branch to sync
  const branch = options.branch || (await manager.getDefaultBranch());

  // Check if the branch is checked out in any worktree
  const worktrees = await manager.listWorktrees();
  const checkedOutWorktree = worktrees.find((wt) => wt.branch === branch);

  if (checkedOutWorktree) {
    console.log(
      chalk.yellow(`Branch '${branch}' is checked out in a worktree. Git won't sync against a checked-out branch (a limitation of git worktrees).`),
    );
    console.log(
      chalk.yellow(`Run 'git fetch origin', then merge or rebase from 'origin/${branch}'.`),
    );
    process.exit(1);
  }

  await manager.syncBranch(branch);

  console.log(chalk.green("✓ Synced"), chalk.bold(branch), chalk.gray("from origin"));
}
