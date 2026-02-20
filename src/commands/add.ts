import { Command } from "commander";
import * as path from "path";
import * as fs from "fs/promises";
import chalk from "chalk";
import { WorktreeManager } from "../git/WorktreeManager";
import { handleCommandError } from "../utils";

interface AddCommandOptions {
  track?: string;
}

interface GrovercCopyConfig {
  from?: string;
  include: string[];
  exclude?: string[];
}

export function createAddCommand(): Command {
  const command = new Command("add");

  command
    .description("Create a new worktree")
    .argument("<name>", "Branch name (creates new branch if it doesn't exist)")
    .option(
      "-t, --track <remote-branch>",
      "Set up tracking for the specified remote branch",
    )
    .action(async (name: string, options: AddCommandOptions) => {
      try {
        await runAdd(name, options);
      } catch (error) {
        handleCommandError(error);
      }
    });

  return command;
}

async function runAdd(name: string, options: AddCommandOptions): Promise<void> {
  if (!name || !name.trim()) {
    throw new Error('Branch name is required');
  }

  // Use discovery to find the bare clone from anywhere in the project hierarchy
  const manager = await WorktreeManager.discover();

  // Get the project root (parent of bare clone) for worktree path calculation
  const projectRoot = manager.getProjectRoot();

  // Determine the worktree path based on the branch name
  // Convert branch name like "feature/my-feature" to a path like "../feature/my-feature"
  const worktreePath = getWorktreePath(name, projectRoot);

  // Try to create worktree for existing branch first, fall back to creating new branch
  // This handles the race condition atomically - git will fail if branch doesn't exist
  let isNewBranch = false;
  try {
    await manager.addWorktree(worktreePath, name, {
      createBranch: false,
      track: options.track,
    });
  } catch (existingBranchError) {
    // Branch doesn't exist, try creating new branch and worktree
    try {
      await manager.addWorktree(worktreePath, name, {
        createBranch: true,
        track: options.track,
      });
      isNewBranch = true;
    } catch (newBranchError) {
      // If both fail, provide context from both attempts
      const existingError = existingBranchError instanceof Error ? existingBranchError.message : String(existingBranchError);
      const newError = newBranchError instanceof Error ? newBranchError.message : String(newBranchError);
      throw new Error(
        `Failed to create worktree for '${name}':\n` +
        `  As existing branch: ${existingError}\n` +
        `  As new branch: ${newError}`
      );
    }
  }

  if (isNewBranch) {
    console.log(chalk.green("✓ Created new branch and worktree:"), chalk.bold(name));
  } else {
    console.log(chalk.green("✓ Created worktree:"), chalk.bold(name));
  }
  console.log(chalk.gray("  Path:"), worktreePath);

  const copyConfig = await readGrovercCopyConfig(projectRoot);
  if (copyConfig) {
    const sourceDir = await resolveCopySourceDirectory(copyConfig, manager);
    const copiedCount = await copyConfiguredEntries(copyConfig, sourceDir, worktreePath);
    if (copiedCount > 0) {
      console.log(chalk.gray("  Copied configured entries:"), copiedCount);
      console.log(chalk.gray("  Copy source:"), sourceDir);
    } else {
      console.log(chalk.gray("  No files matched .groverc copy rules."));
    }
  }
}

function getWorktreePath(branchName: string, projectRoot: string): string {
  // Validate branch name doesn't contain path traversal
  if (branchName.includes('..') || path.isAbsolute(branchName)) {
    throw new Error('Invalid branch name: contains path traversal characters');
  }

  // Sanitize special characters that could cause issues on various filesystems
  const sanitizedName = branchName.replace(/[<>:"|?*]/g, '-');

  // Use the branch name as the directory name
  // Replace slashes with the OS path separator for nested branches
  const dirName = sanitizedName.replace(/\//g, path.sep);

  const worktreePath = path.join(projectRoot, dirName);

  // Ensure the resolved path is within the project root (strict enforcement)
  const resolvedPath = path.resolve(worktreePath);
  const resolvedProjectRoot = path.resolve(projectRoot);
  if (!resolvedPath.startsWith(resolvedProjectRoot + path.sep) && resolvedPath !== resolvedProjectRoot) {
    throw new Error('Invalid branch name: would create worktree outside project');
  }

  return resolvedPath;
}

export async function readGrovercCopyConfig(projectRoot: string): Promise<GrovercCopyConfig | null> {
  const configPath = path.join(projectRoot, ".groverc");
  let configContent: string;

  try {
    configContent = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new Error(`Failed to read .groverc: ${error}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(configContent);
  } catch (error) {
    throw new Error(`Invalid .groverc JSON: ${error}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid .groverc: expected a JSON object.");
  }

  const copy = (parsed as { copy?: unknown }).copy;
  if (copy === undefined) {
    return null;
  }
  if (!copy || typeof copy !== "object") {
    throw new Error("Invalid .groverc copy config: expected an object.");
  }

  const from = (copy as { from?: unknown }).from;
  if (from !== undefined && typeof from !== "string") {
    throw new Error("Invalid .groverc copy.from: expected a string.");
  }

  const include = (copy as { include?: unknown }).include;
  if (!Array.isArray(include) || include.length === 0 || !include.every((entry) => typeof entry === "string" && entry.trim().length > 0)) {
    throw new Error("Invalid .groverc copy.include: expected a non-empty array of strings.");
  }

  const exclude = (copy as { exclude?: unknown }).exclude;
  if (exclude !== undefined && (!Array.isArray(exclude) || !exclude.every((entry) => typeof entry === "string" && entry.trim().length > 0))) {
    throw new Error("Invalid .groverc copy.exclude: expected an array of strings.");
  }

  return {
    from,
    include,
    exclude,
  };
}

async function resolveCopySourceDirectory(copyConfig: GrovercCopyConfig, manager: WorktreeManager): Promise<string> {
  const source = copyConfig.from?.trim();
  if (!source || source === "cwd") {
    return process.cwd();
  }

  const sourceWorktree = await manager.findWorktreeByName(source);
  if (!sourceWorktree) {
    throw new Error(`Configured copy source '${source}' was not found as a worktree.`);
  }

  return sourceWorktree.path;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isGitMetadataPath(relativePath: string): boolean {
  return relativePath === ".git" || relativePath.startsWith(".git/");
}

function hasGlobMagic(pattern: string): boolean {
  return /[*?[\]{}()!+@]/.test(pattern);
}

function shouldExpandBareNamePatternRecursively(pattern: string): boolean {
  return !pattern.includes("/") && !pattern.includes("\\");
}

export async function copyConfiguredEntries(
  copyConfig: GrovercCopyConfig,
  sourceDir: string,
  targetDir: string,
): Promise<number> {
  if (path.resolve(sourceDir) === path.resolve(targetDir)) {
    return 0;
  }

  const includeMatches = new Set<string>();
  for (const pattern of copyConfig.include) {
    const patternsToScan = [pattern];
    if (shouldExpandBareNamePatternRecursively(pattern)) {
      patternsToScan.push(`**/${pattern}`);
    }

    let matched = false;
    for (const scanPattern of patternsToScan) {
      const glob = new Bun.Glob(scanPattern);
      for await (const relativePath of glob.scan({ cwd: sourceDir, dot: true })) {
        matched = true;
        includeMatches.add(normalizeRelativePath(relativePath));
      }
    }

    if (!matched && !hasGlobMagic(pattern)) {
      const normalizedPath = normalizeRelativePath(pattern);
      const explicitPath = path.join(sourceDir, normalizedPath);
      try {
        await fs.stat(explicitPath);
        includeMatches.add(normalizedPath);
      } catch {
        // Explicit path does not exist; continue to next pattern.
      }
    }
  }

  const excludeGlobs = (copyConfig.exclude ?? []).map((pattern) => new Bun.Glob(pattern));
  const toCopy = [...includeMatches]
    .filter((relativePath) => !isGitMetadataPath(relativePath))
    .filter((relativePath) => !excludeGlobs.some((glob) => glob.match(relativePath)))
    .sort();

  for (const relativePath of toCopy) {
    const sourcePath = path.join(sourceDir, relativePath);
    const targetPath = path.join(targetDir, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.cp(sourcePath, targetPath, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  }

  return toCopy.length;
}
