import { Command } from "commander";
import * as path from "path";
import chalk from "chalk";
import { WorktreeManager } from "../git/WorktreeManager";

interface AddCommandOptions {
  track?: string;
}

export function createAddCommand(): Command {
  const command = new Command("add");

  command
    .description("Create a new worktree")
    .argument("<name>", "Branch name (creates new branch if it doesn't exist)")
    .option(
      "-t, --track <remote-branch>",
      "Set up tracking for the specified remote branch",
    )
    .action(async (name: string, options: AddCommandOptions) => {
      try {
        await runAdd(name, options);
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

async function runAdd(name: string, options: AddCommandOptions): Promise<void> {
  const manager = new WorktreeManager();
  await manager.initialize();

  // Determine the worktree path based on the branch name
  // Convert branch name like "feature/my-feature" to a path like "../feature/my-feature"
  const worktreePath = getWorktreePath(name);

  console.log(chalk.blue(`Creating worktree for '${name}'...`));

  // Check if branch exists, otherwise create it
  const branchExists = await manager.branchExists(name);
  
  if (branchExists) {
    // Create worktree from existing branch
    await manager.addWorktree(worktreePath, name, {
      createBranch: false,
      track: options.track,
    });
    console.log(chalk.green("✓ Created worktree:"), chalk.bold(name));
  } else {
    // Branch doesn't exist, create new branch and worktree
    await manager.addWorktree(worktreePath, name, {
      createBranch: true,
      track: options.track,
    });
    console.log(
      chalk.green("✓ Created new branch and worktree:"),
      chalk.bold(name),
    );
  }

  console.log(chalk.gray("  Path:"), worktreePath);
  console.log();
  console.log(chalk.yellow("To switch to this worktree:"));
  console.log(chalk.gray(`  cd ${worktreePath}`));
}

function getWorktreePath(branchName: string): string {
  // Get the current working directory
  const cwd = process.cwd();
  const parentDir = path.dirname(cwd);

  // Use the branch name as the directory name
  // Replace slashes with the OS path separator for nested branches
  const dirName = branchName.replace(/\//g, path.sep);

  return path.join(parentDir, dirName);
}
