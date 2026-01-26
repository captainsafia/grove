import { Command } from "commander";
import { spawn } from "child_process";
import chalk from "chalk";
import { WorktreeManager } from "../git/WorktreeManager";
import { getShellSetupInstructions, markShellTipShown, shouldShowShellTip } from "./shell-init";
import { handleCommandError, formatCreatedTime } from "../utils";
import { Worktree } from "../models";

interface GoCommandOptions {
  pathOnly: boolean;
}

export function createGoCommand(): Command {
  const command = new Command("go");

  command
    .description("Navigate to a worktree by branch name")
    .argument("[name]", "Branch name or worktree name to navigate to (optional)")
    .option("-p, --path-only", "Output path only (used by shell integration)", false)
    .action(async (name: string | undefined, options: GoCommandOptions) => {
      try {
        await runGo(name, options);
      } catch (error) {
        handleCommandError(error);
      }
    });

  return command;
}

async function runGo(name: string | undefined, options: GoCommandOptions): Promise<void> {
  // Use discovery to find the bare clone from anywhere in the project hierarchy
  const manager = await WorktreeManager.discover();

  // If no name provided, list all worktrees
  if (!name || !name.trim()) {
    await listWorktrees(manager);
    return;
  }

  const worktree = await manager.findWorktreeByName(name);

  if (!worktree) {
    throw new Error(`Worktree '${name}' not found. Use 'grove list' to see available worktrees.`);
  }

  // If path-only mode, just output the path (for shell integration to use)
  if (options.pathOnly) {
    console.log(worktree.path);
    return;
  }

  // Normal mode: spawn an interactive shell
  // Get the user's default shell
  const shell = process.env.SHELL || "/bin/sh";

  console.log(chalk.green("✓ Entering worktree:"), chalk.bold(worktree.branch));
  console.log(chalk.gray("  Path:"), worktree.path);

  // Show shell integration tip on first use only (when not using shell integration)
  if (await shouldShowShellTip()) {
    const setupInfo = getShellSetupInstructions();
    if (setupInfo) {
      console.log(setupInfo.instructions);
      await markShellTipShown();
    }
  }

  console.log();

  // Spawn an interactive shell in the worktree directory
  const child = spawn(shell, [], {
    cwd: worktree.path,
    stdio: "inherit",
    env: {
      ...process.env,
      GROVE_WORKTREE: worktree.branch,
    },
  });

  // Wait for the shell to exit
  await new Promise<void>((resolve, reject) => {
    child.on("close", (code, signal) => {
      if (signal) {
        console.log(chalk.gray(`Shell terminated by signal: ${signal}`));
      } else {
        console.log(chalk.gray("Exited worktree shell."));
      }
      resolve();
    });
    child.on("error", reject);
  });
}

async function listWorktrees(manager: WorktreeManager): Promise<void> {
  console.log(chalk.gray("Available worktrees:"));
  console.log(chalk.gray("Legend: ") + chalk.green("green") + chalk.gray(" = clean, ") + chalk.yellow("yellow") + chalk.gray(" = dirty"));
  console.log();

  let foundAny = false;

  for await (const worktree of manager.streamWorktrees()) {
    foundAny = true;
    printWorktreeItem(worktree);
  }

  if (!foundAny) {
    console.log(chalk.yellow("No worktrees found."));
  } else {
    console.log();
    console.log(chalk.gray("Usage: grove go <branch-name>"));
  }
}

function printWorktreeItem(worktree: Worktree): void {
  // Color the branch based on dirty status
  let branchDisplay = worktree.branch;
  if (worktree.isDirty) {
    branchDisplay = chalk.yellow(branchDisplay);
  } else {
    branchDisplay = chalk.green(branchDisplay);
  }

  const createdStr = formatCreatedTime(worktree.createdAt);

  // Simple format: branch name and time
  console.log(`  ${branchDisplay}  ${chalk.gray(createdStr)}`);
}
