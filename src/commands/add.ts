import { Command } from "commander";
import * as path from "path";
import chalk from "chalk";
import { WorktreeManager } from "../git/WorktreeManager";
import { handleCommandError } from "../utils";

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
        handleCommandError(error);
      }
    });

  return command;
}

async function runAdd(name: string, options: AddCommandOptions): Promise<void> {
  if (!name || !name.trim()) {
    throw new Error('Branch name is required');
  }

  // Use discovery to find the bare clone from anywhere in the project hierarchy
  const manager = await WorktreeManager.discover();

  // Get the project root (parent of bare clone) for worktree path calculation
  const projectRoot = manager.getProjectRoot();

  // Determine the worktree path based on the branch name
  // Convert branch name like "feature/my-feature" to a path like "../feature/my-feature"
  const worktreePath = getWorktreePath(name, projectRoot);

  // Try to create worktree for existing branch first, fall back to creating new branch
  // This handles the race condition atomically - git will fail if branch doesn't exist
  let isNewBranch = false;
  try {
    await manager.addWorktree(worktreePath, name, {
      createBranch: false,
      track: options.track,
    });
  } catch (existingBranchError) {
    // Branch doesn't exist, try creating new branch and worktree
    try {
      await manager.addWorktree(worktreePath, name, {
        createBranch: true,
        track: options.track,
      });
      isNewBranch = true;
    } catch (newBranchError) {
      // If both fail, provide context from both attempts
      const existingError = existingBranchError instanceof Error ? existingBranchError.message : String(existingBranchError);
      const newError = newBranchError instanceof Error ? newBranchError.message : String(newBranchError);
      throw new Error(
        `Failed to create worktree for '${name}':\n` +
        `  As existing branch: ${existingError}\n` +
        `  As new branch: ${newError}`
      );
    }
  }

  if (isNewBranch) {
    console.log(chalk.green("✓ Created new branch and worktree:"), chalk.bold(name));
  } else {
    console.log(chalk.green("✓ Created worktree:"), chalk.bold(name));
  }
  console.log(chalk.gray("  Path:"), worktreePath);
}

function getWorktreePath(branchName: string, projectRoot: string): string {
  // Validate branch name doesn't contain path traversal
  if (branchName.includes('..') || path.isAbsolute(branchName)) {
    throw new Error('Invalid branch name: contains path traversal characters');
  }

  // Sanitize special characters that could cause issues on various filesystems
  const sanitizedName = branchName.replace(/[<>:"|?*]/g, '-');

  // Use the branch name as the directory name
  // Replace slashes with the OS path separator for nested branches
  const dirName = sanitizedName.replace(/\//g, path.sep);

  const worktreePath = path.join(projectRoot, dirName);

  // Ensure the resolved path is within the project root (strict enforcement)
  const resolvedPath = path.resolve(worktreePath);
  const resolvedProjectRoot = path.resolve(projectRoot);
  if (!resolvedPath.startsWith(resolvedProjectRoot + path.sep) && resolvedPath !== resolvedProjectRoot) {
    throw new Error('Invalid branch name: would create worktree outside project');
  }

  return resolvedPath;
}
