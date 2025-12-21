import { Command } from "commander";
import { spawn } from "child_process";
import chalk from "chalk";
import { WorktreeManager } from "../git/WorktreeManager";

export function createGoCommand(): Command {
  const command = new Command("go");

  command
    .description("Navigate to a worktree by branch name")
    .argument("<name>", "Branch name or worktree name to navigate to")
    .action(async (name: string) => {
      try {
        await runGo(name);
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

async function runGo(name: string): Promise<void> {
  const manager = new WorktreeManager();
  await manager.initialize();

  const worktree = await manager.findWorktreeByName(name);

  if (!worktree) {
    throw new Error(`Worktree '${name}' not found. Use 'grove list' to see available worktrees.`);
  }

  // Get the user's default shell
  const shell = process.env.SHELL || "/bin/sh";

  console.log(chalk.blue(`Entering worktree '${worktree.branch}' at ${worktree.path}`));
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
    child.on("close", (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`Shell exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}
