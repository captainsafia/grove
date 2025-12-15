import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { WorktreeManager } from "../git/WorktreeManager";

interface RemoveCommandOptions {
  force: boolean;
  yes: boolean;
}

export function createRemoveCommand(): Command {
  const command = new Command("remove");

  command
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
        console.error(
          chalk.red("Error:"),
          error instanceof Error ? error.message : error,
        );
        process.exit(1);
      }
    });

  return command;
}

async function runRemove(
  name: string,
  options: RemoveCommandOptions,
): Promise<void> {
  const manager = new WorktreeManager();
  await manager.initialize();

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

  // Warn about dirty worktrees
  if (worktree.isDirty && !options.force) {
    console.log(chalk.yellow("Warning: This worktree has uncommitted changes."));
    console.log(
      chalk.yellow("Use --force to remove it anyway, or commit/stash your changes first."),
    );
    console.log();
  }

  // Show worktree info
  console.log(chalk.blue("Worktree to remove:"));
  console.log(chalk.gray("  Path:"), worktree.path);
  console.log(chalk.gray("  Branch:"), worktree.branch);
  if (worktree.isDirty) {
    console.log(chalk.yellow("  Status: dirty (uncommitted changes)"));
  }
  console.log();

  // Confirm removal
  if (!options.yes) {
    const answers = await inquirer.prompt([
      {
        type: "confirm",
        name: "proceed",
        message: `Are you sure you want to remove the worktree for '${worktree.branch}'?`,
        default: false,
      },
    ]);

    if (!answers.proceed) {
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
