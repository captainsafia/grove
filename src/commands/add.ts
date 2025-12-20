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

  // Try to create worktree for existing branch first, fall back to creating new branch
  // This handles the race condition atomically - git will fail if branch doesn't exist
  try {
    await manager.addWorktree(worktreePath, name, {
      createBranch: false,
      track: options.track,
    });
    console.log(chalk.green("✓ Created worktree:"), chalk.bold(name));
  } catch (existingBranchError) {
    // Branch doesn't exist, try creating new branch and worktree
    try {
      await manager.addWorktree(worktreePath, name, {
        createBranch: true,
        track: options.track,
      });
      console.log(
        chalk.green("✓ Created new branch and worktree:"),
        chalk.bold(name),
      );
    } catch (newBranchError) {
      // If both fail, provide a helpful error message
      const errorMessage = newBranchError instanceof Error ? newBranchError.message : String(newBranchError);
      throw new Error(`Failed to create worktree: ${errorMessage}`);
    }
  }

  console.log(chalk.gray("  Path:"), worktreePath);
  console.log();
  console.log(chalk.yellow("To switch to this worktree:"));
  console.log(chalk.gray(`  cd ${worktreePath}`));
}

function getWorktreePath(branchName: string): string {
  // Validate branch name doesn't contain path traversal
  if (branchName.includes('..') || path.isAbsolute(branchName)) {
    throw new Error('Invalid branch name: contains path traversal characters');
  }

  // Sanitize special characters that could cause issues on various filesystems
  const sanitizedName = branchName.replace(/[<>:"|?*]/g, '-');

  // Get the current working directory
  const cwd = process.cwd();
  const parentDir = path.dirname(cwd);

  // Use the branch name as the directory name
  // Replace slashes with the OS path separator for nested branches
  const dirName = sanitizedName.replace(/\//g, path.sep);

  const worktreePath = path.join(parentDir, dirName);

  // Ensure the resolved path is within the parent directory
  const resolvedPath = path.resolve(worktreePath);
  if (!resolvedPath.startsWith(path.resolve(parentDir) + path.sep) && resolvedPath !== path.resolve(parentDir)) {
    throw new Error('Invalid branch name: would create worktree outside project');
  }

  return resolvedPath;
}
