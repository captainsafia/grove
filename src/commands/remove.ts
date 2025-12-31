import { Command } from "commander";
import chalk from "chalk";
import confirm from "@inquirer/confirm";
import { WorktreeManager } from "../git/WorktreeManager";
import { handleCommandError } from "../utils";

interface RemoveCommandOptions {
  force: boolean;
  yes: boolean;
}

export function createRemoveCommand(): Command {
  const command = new Command("remove");

  command
    .alias("rm")
    .description("Remove a worktree")
    .argument("<name>", "Branch name or path of the worktree to remove")
    .option(
      "--force",
      "Remove the worktree even if it has uncommitted changes",
      false,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .action(async (name: string, options: RemoveCommandOptions) => {
      try {
        await runRemove(name, options);
      } catch (error) {
        handleCommandError(error);
      }
    });

  return command;
}

async function runRemove(
  name: string,
  options: RemoveCommandOptions,
): Promise<void> {
  if (!name || !name.trim()) {
    throw new Error('Branch name is required');
  }

  // Use discovery to find the bare clone from anywhere in the project hierarchy
  const manager = await WorktreeManager.discover();

  // Find the worktree by branch name or path
  const worktrees = await manager.listWorktrees();
  const worktree = worktrees.find(
    (wt) =>
      wt.branch === name ||
      wt.path === name ||
      wt.path.endsWith(`/${name}`) ||
      wt.path.endsWith(`\\${name}`),
  );

  if (!worktree) {
    throw new Error(
      `Worktree '${name}' not found. Use 'grove list' to see available worktrees.`,
    );
  }

  if (worktree.isMain) {
    throw new Error(
      `Cannot remove the main worktree (${worktree.branch}). This is the primary worktree.`,
    );
  }

  if (worktree.isLocked) {
    throw new Error(
      `Worktree '${worktree.branch}' is locked. Unlock it first with 'git worktree unlock'.`,
    );
  }

  // Block removal of dirty worktrees without --force
  if (worktree.isDirty && !options.force) {
    console.log(chalk.yellow("Warning: This worktree has uncommitted changes."));
    console.log(
      chalk.yellow("Use --force to remove it anyway, or commit/stash your changes first."),
    );
    process.exit(1);
  }

  // Confirm removal
  if (!options.yes) {
    const confirmMessage = worktree.isDirty
      ? `Are you sure you want to remove the worktree for '${worktree.branch}'? Uncommitted changes will be lost!`
      : `Are you sure you want to remove the worktree for '${worktree.branch}'?`;

    const proceed = await confirm({
      message: confirmMessage,
      default: false,
    });

    if (!proceed) {
      console.log(chalk.blue("Operation cancelled."));
      return;
    }
  }

  // Remove the worktree
  await manager.removeWorktree(worktree.path, options.force);
  console.log(
    chalk.green("✓ Removed worktree:"),
    chalk.bold(worktree.branch),
  );
}
