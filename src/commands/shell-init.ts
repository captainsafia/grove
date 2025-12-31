import { Command } from "commander";
import chalk from "chalk";
import { readConfig, writeConfig, handleCommandError } from "../utils";

const BASH_ZSH_FUNCTION = `grove() {
  if [[ "$1" == "go" ]]; then
    local output
    output=$(command grove go "\${@:2}" -p 2>&1)
    local exit_code=$?
    if [[ $exit_code -eq 0 && -d "$output" ]]; then
      cd "$output"
    else
      echo "$output"
      return $exit_code
    fi
  else
    command grove "$@"
  fi
}`;

const FISH_FUNCTION = `function grove
  if test "$argv[1]" = "go"
    set -l output (command grove go $argv[2..-1] -p 2>&1)
    set -l exit_code $status
    if test $exit_code -eq 0 -a -d "$output"
      cd "$output"
    else
      echo "$output"
      return $exit_code
    end
  else
    command grove $argv
  end
end`;

export function createShellInitCommand(): Command {
  const command = new Command("shell-init");

  command
    .description("Output shell integration function for grove go")
    .argument("<shell>", "Shell type: bash, zsh, or fish")
    .action(async (shell: string) => {
      try {
        await runShellInit(shell);
      } catch (error) {
        handleCommandError(error);
      }
    });

  return command;
}

async function runShellInit(shell: string): Promise<void> {
  const normalizedShell = shell.toLowerCase();

  switch (normalizedShell) {
    case "bash":
    case "zsh":
      console.log(BASH_ZSH_FUNCTION);
      break;
    case "fish":
      console.log(FISH_FUNCTION);
      break;
    default:
      throw new Error(
        `Unsupported shell: ${shell}\n` +
        `Supported shells: bash, zsh, fish`
      );
  }
}

/**
 * Detect the current shell with fallback options.
 * Primary: $SHELL (login shell)
 * Fallback: Check common shell indicators
 */
function detectShell(): { shell: string; configFile: string } | null {
  const shellPath = process.env.SHELL || "";
  const shellName = process.env.SHELL_NAME || ""; // Some shells set this

  // Check $SHELL first (most common case)
  if (shellPath.includes("zsh") || shellName === "zsh") {
    return { shell: "zsh", configFile: "~/.zshrc" };
  }
  if (shellPath.includes("bash") || shellName === "bash") {
    return { shell: "bash", configFile: "~/.bashrc" };
  }
  if (shellPath.includes("fish") || shellName === "fish") {
    return { shell: "fish", configFile: "~/.config/fish/config.fish" };
  }

  // Fallback: check for fish-specific env vars
  if (process.env.FISH_VERSION) {
    return { shell: "fish", configFile: "~/.config/fish/config.fish" };
  }

  // Fallback: check for zsh-specific env vars
  if (process.env.ZSH_VERSION) {
    return { shell: "zsh", configFile: "~/.zshrc" };
  }

  // Fallback: check for bash-specific env vars
  if (process.env.BASH_VERSION) {
    return { shell: "bash", configFile: "~/.bashrc" };
  }

  return null;
}

/**
 * Check if we should show the shell setup tip.
 */
export async function shouldShowShellTip(): Promise<boolean> {
  const config = await readConfig();
  return !config.shellTipShown;
}

/**
 * Mark the shell tip as shown so it won't appear again.
 */
export async function markShellTipShown(): Promise<void> {
  const config = await readConfig();
  config.shellTipShown = true;
  await writeConfig(config);
}

/**
 * Get the shell integration setup instructions for the detected shell.
 */
export function getShellSetupInstructions(): { shell: string; instructions: string } | null {
  const detected = detectShell();
  if (!detected) {
    return null;
  }

  const { shell, configFile } = detected;

  const instructions = `
${chalk.bold("Tip:")} Add shell integration to change directories automatically.
Run this command to set it up:

  ${chalk.cyan(`echo 'eval "$(grove shell-init ${shell})"' >> ${configFile}`)}

Then restart your shell or run: ${chalk.cyan(`source ${configFile}`)}`;

  return { shell, instructions };
}
