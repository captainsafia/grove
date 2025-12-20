import { Command } from "commander";
import chalk from "chalk";
import { WorktreeManager } from "../git/WorktreeManager";

interface SyncCommandOptions {
  branch?: string;
}

export function createSyncCommand(): Command {
  const command = new Command("sync");

  command
    .description("Sync the bare clone with the latest changes from origin")
    .option(
      "-b, --branch <branch>",
      "Branch to sync (defaults to main or master)",
    )
    .action(async (options: SyncCommandOptions) => {
      try {
        await runSync(options);
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

async function runSync(options: SyncCommandOptions): Promise<void> {
  const manager = new WorktreeManager();
  await manager.initialize();

  // Determine the branch to sync
  const branch = options.branch || (await manager.getDefaultBranch());

  console.log(chalk.blue(`Syncing '${branch}' from origin...`));

  await manager.syncBranch(branch);

  console.log(chalk.green("✓ Successfully synced"), chalk.bold(branch));
}
