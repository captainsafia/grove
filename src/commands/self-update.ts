import { Command } from "commander";
import chalk from "chalk";

interface SelfUpdateCommandOptions {
  pr?: string;
}

export function createSelfUpdateCommand(): Command {
  const command = new Command("self-update");

  command
    .description("Update grove to a specific version or PR")
    .argument("[version]", "Version to update to (e.g., v1.0.0 or 1.0.0). Defaults to latest.")
    .option("--pr <number>", "Update to a specific PR build")
    .action(async (version?: string, options?: SelfUpdateCommandOptions) => {
      try {
        await runSelfUpdate(version, options);
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

async function runSelfUpdate(
  version: string | undefined,
  options: SelfUpdateCommandOptions | undefined,
): Promise<void> {
  console.log(chalk.blue("🌳 Grove Self-Update"));
  console.log();

  // Check if both version and PR are specified
  if (version && options?.pr) {
    throw new Error("Cannot specify both version and --pr option");
  }

  // Validate PR number to prevent command injection
  if (options?.pr && !/^\d+$/.test(options.pr)) {
    throw new Error("Invalid PR number: must be a positive integer");
  }

  // Validate version format to prevent command injection
  if (version && !/^v?\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    throw new Error("Invalid version format: must be semver (e.g., v1.0.0 or 1.0.0)");
  }

  // Construct the install command
  const installScriptUrl = "https://safia.rocks/grove/install.sh";
  let installCommand: string;

  if (options?.pr) {
    console.log(chalk.yellow(`Updating to PR #${options.pr}...`));
    installCommand = `curl -fsSL ${installScriptUrl} | sh -s -- --pr ${options.pr}`;
  } else if (version) {
    // Ensure version starts with 'v'
    const versionTag = version.startsWith("v") ? version : `v${version}`;
    console.log(chalk.yellow(`Updating to version ${versionTag}...`));
    installCommand = `curl -fsSL ${installScriptUrl} | sh -s -- ${versionTag}`;
  } else {
    console.log(chalk.yellow("Updating to latest version..."));
    installCommand = `curl -fsSL ${installScriptUrl} | sh`;
  }

  console.log();
  console.log(chalk.dim("Running:"), chalk.dim(installCommand));
  console.log();

  // Execute the install command
  const proc = Bun.spawn(["sh", "-c", installCommand], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Update failed with exit code ${exitCode}`);
  }

  console.log();
  console.log(chalk.green("✅ Update completed successfully!"));
  console.log();
  console.log(
    chalk.dim("Note: If you installed grove using a different method,"),
  );
  console.log(
    chalk.dim(
      "you may need to restart your shell for changes to take effect.",
    ),
  );
}
