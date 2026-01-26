import { Command } from "commander";
import { spawn } from "child_process";
import chalk from "chalk";
import search from "@inquirer/search";
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

  // If no name provided, show interactive picker
  if (!name || !name.trim()) {
    await showWorktreePicker(manager, options);
    return;
  }

  const worktree = await manager.findWorktreeByName(name);

  if (!worktree) {
    throw new Error(`Worktree '${name}' not found. Use 'grove list' to see available worktrees.`);
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

async function showWorktreePicker(manager: WorktreeManager, options: GoCommandOptions): Promise<void> {
  // Check for interactive terminal
  if (!process.stdin.isTTY) {
    console.error(chalk.red("Error: Interactive selection requires a TTY."));
    console.error(chalk.gray("Use 'grove go <branch-name>' or 'grove list' instead."));
    process.exit(1);
  }

  // Collect all worktrees
  const worktrees: Worktree[] = [];
  for await (const worktree of manager.streamWorktrees()) {
    worktrees.push(worktree);
  }

  if (worktrees.length === 0) {
    console.log(chalk.yellow("No worktrees found."));
    return;
  }

  // Show interactive picker with fuzzy search
  let selectedWorktree: Worktree;
  try {
    selectedWorktree = await search({
      message: "Select a worktree (type to search):",
      source: async (term) => {
        const searchTerm = (term || "").toLowerCase();

        return worktrees
          .filter((wt) => wt.branch.toLowerCase().includes(searchTerm))
          .map((wt) => {
            const createdStr = formatCreatedTime(wt.createdAt);
            const statusIndicator = wt.isDirty ? chalk.yellow("●") : chalk.green("●");

            return {
              name: `${statusIndicator} ${wt.branch} ${chalk.gray(`(${createdStr})`)}`,
              value: wt,
              description: wt.path,
            };
          });
      },
    });
  } catch (error) {
    // Handle user cancellation (Ctrl+C or Escape)
    if (error instanceof Error && error.name === "ExitPromptError") {
      console.log(chalk.gray("Selection cancelled."));
      return;
    }
    throw error;
  }

  await navigateToWorktree(selectedWorktree, options);
}
