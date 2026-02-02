import { Command } from "commander";
import { access, mkdir, rm } from "fs/promises";
import * as path from "path";
import chalk from "chalk";
import { WorktreeManager } from "../git/WorktreeManager";
import { extractRepoName, isValidGitUrl, findGroveRepo, handleCommandError } from "../utils";

export function createInitCommand(): Command {
  const command = new Command("init");

  command
    .description("Initialize a new worktree setup")
    .argument("<git-url>", "Git repository URL to clone")
    .action(async (gitUrl: string) => {
      try {
        await runInit(gitUrl);
      } catch (error) {
        handleCommandError(error);
      }
    });

  return command;
}

async function runInit(gitUrl: string): Promise<void> {
  // Check if we're inside an existing grove repository (prevent nesting)
  const existingGroveRepo = await findGroveRepo();
  if (existingGroveRepo) {
    throw new Error(
      `Cannot initialize grove inside an existing grove repository.\n` +
      `Detected grove repository at: ${existingGroveRepo}\n\n` +
      `To create a new grove setup, run 'grove init' from outside this directory hierarchy.`
    );
  }

  // Validate git URL format
  if (!isValidGitUrl(gitUrl)) {
    throw new Error(
      "Invalid git URL format. Supported formats:\n" +
      "  - HTTPS: https://github.com/user/repo.git\n" +
      "  - SSH: git@github.com:user/repo.git\n" +
      "  - SSH: ssh://git@github.com/user/repo.git"
    );
  }

  // Extract repository name from URL
  const repoName = extractRepoName(gitUrl);

  // Track if we created the directory (for cleanup)
  let createdDir = false;

  // Create directory with repo name
  try {
    await access(repoName);
  } catch {
    await mkdir(repoName, { recursive: true });
    createdDir = true;
  }

  // Define bare repo directory
  const bareRepoDir = path.join(repoName, `${repoName}.git`);

  // Check if directory already exists
  try {
    await access(bareRepoDir);
    throw new Error(`Directory ${bareRepoDir} already exists`);
  } catch (error) {
    // If error is about directory already existing, rethrow
    if (error instanceof Error && error.message.includes('already exists')) {
      throw error;
    }
    // Otherwise, directory doesn't exist, which is what we want
  }

  try {
    const manager = new WorktreeManager();
    await manager.cloneBareRepository(gitUrl, bareRepoDir);

    console.log(
      chalk.green("✓ Initialized worktree setup:"),
      chalk.bold(repoName),
    );
    console.log(chalk.gray("  Bare repository:"), bareRepoDir);
    console.log();
    console.log(chalk.bold("Next steps:"));
    console.log(chalk.gray("  cd"), bareRepoDir);
    console.log(chalk.gray("  grove add <branch-name>"));
  } catch (error) {
    // Clean up on failure - only remove if we created the directory
    if (createdDir) {
      try {
        await rm(repoName, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn(chalk.yellow(`Warning: Failed to clean up ${repoName}: ${cleanupError}`));
      }
    }
    throw error;
  }
}
