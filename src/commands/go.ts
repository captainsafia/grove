import { Command } from "commander";
import { spawn } from "child_process";
import chalk from "chalk";
import { WorktreeManager } from "../git/WorktreeManager";
import { getShellSetupInstructions, markShellTipShown, shouldShowShellTip } from "./shell-init";
import { handleCommandError } from "../utils";
import { Worktree } from "../models";
import { pickWorktree } from "./worktree-picker";

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

  let worktree: Worktree | null | undefined;

  // If no name provided, show interactive picker
  if (!name || !name.trim()) {
    const worktrees: Worktree[] = [];
    for await (const wt of manager.streamWorktrees()) {
      worktrees.push(wt);
    }

    worktree = await pickWorktree(worktrees);
    if (!worktree) {
      return;
    }
  } else {
    worktree = await manager.findWorktreeByName(name);

    if (!worktree) {
      throw new Error(`Worktree '${name}' not found. Use 'grove list' to see available worktrees.`);
    }
  }

  await navigateToWorktree(worktree, options);
}

async function navigateToWorktree(worktree: Worktree, options: GoCommandOptions): Promise<void> {
  // If path-only mode, just output the path (for shell integration to use)
  if (options.pathOnly) {
    console.log(worktree.path);
    return;
  }

  // Normal mode: spawn an interactive shell
  // Get the user's default shell
  const isWindows = process.platform === "win32";
  const shell = isWindows
    ? "powershell"
    : (process.env.SHELL || "/bin/sh");

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

