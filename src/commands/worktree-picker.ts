import chalk from "chalk";
import search from "@inquirer/search";
import { Worktree } from "../models";
import { formatCreatedTime } from "../utils";

export interface PickerOptions {
  message?: string;
  /** Filter function to exclude certain worktrees from the picker */
  filter?: (worktree: Worktree) => boolean;
}

/**
 * Show an interactive fuzzy search picker for worktrees.
 * Returns the selected worktree, or null if cancelled.
 */
export async function pickWorktree(
  worktrees: Worktree[],
  options: PickerOptions = {},
): Promise<Worktree | null> {
  const { message = "Select a worktree (type to search):", filter } = options;

  // Check for interactive terminal
  if (!process.stdin.isTTY) {
    console.error(chalk.red("Error: Interactive selection requires a TTY."));
    console.error(chalk.gray("Provide a branch name argument or use 'grove list' instead."));
    process.exit(1);
  }

  // Apply filter if provided
  const filteredWorktrees = filter ? worktrees.filter(filter) : worktrees;

  if (filteredWorktrees.length === 0) {
    console.log(chalk.yellow("No worktrees found."));
    return null;
  }

  try {
    const selectedWorktree = await search({
      message,
      source: async (term) => {
        const searchTerm = (term || "").toLowerCase();

        return filteredWorktrees
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

    return selectedWorktree;
  } catch (error) {
    // Handle user cancellation (Ctrl+C or Escape)
    if (error instanceof Error && error.name === "ExitPromptError") {
      console.log(chalk.gray("Selection cancelled."));
      return null;
    }
    throw error;
  }
}
