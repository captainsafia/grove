import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { WorktreeManager } from "../git/WorktreeManager";
import { extractRepoName } from "../utils";

export function createInitCommand(): Command {
  const command = new Command("init");

  command
    .description("Initialize a new worktree setup")
    .argument("<git-url>", "Git repository URL to clone")
    .action(async (gitUrl: string) => {
      try {
        await runInit(gitUrl);
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

async function runInit(gitUrl: string): Promise<void> {
  // Extract repository name from URL
  const repoName = extractRepoName(gitUrl);

  // Create directory with repo name
  if (!fs.existsSync(repoName)) {
    fs.mkdirSync(repoName, { recursive: true });
  }

  // Define bare repo directory
  const bareRepoDir = path.join(repoName, `${repoName}.git`);

  // Check if directory already exists
  if (fs.existsSync(bareRepoDir)) {
    throw new Error(`Directory ${bareRepoDir} already exists`);
  }

  try {
    console.log(chalk.blue(`Cloning ${gitUrl} into ${bareRepoDir}...`));

    const manager = new WorktreeManager();
    await manager.cloneBareRepository(gitUrl, bareRepoDir);

    console.log(
      chalk.green("✓ Successfully initialized worktree setup in"),
      chalk.bold(repoName),
    );
    console.log(chalk.gray("  Bare repository:"), bareRepoDir);
    console.log();
    console.log(chalk.yellow("Next steps:"));
    console.log(chalk.gray(`  cd ${repoName}`));
    console.log(chalk.gray("  grove add main"));
    console.log(chalk.gray("  grove add feature/new-feature"));
  } catch (error) {
    // Clean up on failure
    if (fs.existsSync(repoName)) {
      fs.rmSync(repoName, { recursive: true, force: true });
    }
    throw error;
  }
}
