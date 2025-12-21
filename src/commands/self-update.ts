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
    installCommand = `curl -fsSL ${installScriptUrl} | sh -s -- --pr ${options.pr}`;
  } else if (version) {
    // Ensure version starts with 'v'
    const versionTag = version.startsWith("v") ? version : `v${version}`;
    installCommand = `curl -fsSL ${installScriptUrl} | sh -s -- ${versionTag}`;
  } else {
    installCommand = `curl -fsSL ${installScriptUrl} | sh`;
  }

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
  console.log(chalk.green("✓ Update completed successfully"));
}
