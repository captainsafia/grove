import { Command } from "commander";
import chalk from "chalk";
import { WorktreeManager } from "../git/WorktreeManager";
import { handleCommandError } from "../utils";
import { execSync } from "child_process";
import path from "path";

export function createPrCommand(): Command {
  const command = new Command("pr");

  command
    .description("Checkout a GitHub pull request into a new worktree")
    .argument("<pr-number>", "Pull request number")
    .action(async (prNumber: string) => {
      try {
        await runPr(prNumber);
      } catch (error) {
        handleCommandError(error);
      }
    });

  return command;
}

async function runPr(prNumber: string): Promise<void> {
  const prNum = parseInt(prNumber, 10);
  if (isNaN(prNum) || prNum <= 0) {
    throw new Error(`Invalid PR number: ${prNumber}`);
  }

  try {
    execSync("gh --version", { stdio: "ignore" });
  } catch (error) {
    throw new Error("gh CLI is not installed. Please install it from https://cli.github.com/");
  }

  const manager = await WorktreeManager.discover();
  const bareRepoPath = manager.getRepoPath();
  const projectRoot = manager.getProjectRoot();

  console.log(chalk.gray(`Fetching PR #${prNum} information...`));

  let prInfo: { headRefName: string; headRepository: string };
  try {
    const output = execSync(
      `gh pr view ${prNum} --json headRefName,headRepository`,
      { encoding: "utf-8", cwd: bareRepoPath }
    );
    prInfo = JSON.parse(output);
  } catch (error) {
    throw new Error(`Failed to fetch PR #${prNum}. Make sure the PR exists and you have access to the repository.`);
  }

  const branchName = prInfo.headRefName;
  if (!branchName) {
    throw new Error(`Could not determine branch name for PR #${prNum}`);
  }

  const cleanedBranchName = branchName
    .replace(/[^a-zA-Z0-9-_\/]/g, "-")
    .replace(/\//g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const worktreeName = `pr-${prNum}-${cleanedBranchName}`;
  const worktreePath = path.join(projectRoot, worktreeName);

  const existingWorktree = await manager.findWorktreeByName(worktreeName);
  if (existingWorktree) {
    console.log(chalk.yellow("⚠ Worktree already exists:"), chalk.bold(worktreePath));
    return;
  }

  console.log(chalk.gray(`Fetching PR branch: ${branchName}...`));
  try {
    execSync(
      `git fetch origin pull/${prNum}/head:pr-${prNum}`,
      { stdio: "pipe", cwd: bareRepoPath }
    );
  } catch (error) {
    throw new Error(`Failed to fetch PR #${prNum}. ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log(chalk.gray(`Creating worktree: ${worktreeName}...`));
  await manager.addWorktree(worktreePath, `pr-${prNum}`, {});

  console.log(chalk.green("✓ Created worktree for PR"), chalk.bold(`#${prNum}`));
  console.log(chalk.gray("  Branch:"), chalk.bold(branchName));
  console.log(chalk.gray("  Path:"), chalk.bold(worktreePath));
  console.log();
  console.log(chalk.gray("To switch to this worktree, run:"));
  console.log(chalk.cyan(`  grove go ${worktreeName}`));
}
