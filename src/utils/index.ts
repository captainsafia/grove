import * as path from "path";
import * as fs from "fs";
import { realpath, readFile, stat, writeFile, mkdir } from "fs/promises";
import { simpleGit } from "simple-git";
import chalk from "chalk";

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Standard error handler for CLI commands.
 * Formats and displays the error, then exits with code 1.
 */
export function handleCommandError(error: unknown): never {
  console.error(
    chalk.red("Error:"),
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get the path to the grove config directory (~/.config/grove).
 */
export function getConfigDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(home, ".config", "grove");
}

/**
 * Get the path to the grove config file (~/.config/grove/config.json).
 */
export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

interface GroveConfig {
  shellTipShown?: boolean;
}

/**
 * Read the grove config file.
 */
export async function readConfig(): Promise<GroveConfig> {
  try {
    const content = await readFile(getConfigPath(), "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Write to the grove config file.
 */
export async function writeConfig(config: GroveConfig): Promise<void> {
  const configDir = getConfigDir();
  await mkdir(configDir, { recursive: true });
  await writeFile(getConfigPath(), JSON.stringify(config, null, 2));
}

// Duration constants in milliseconds
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const MS_PER_MONTH = 30 * MS_PER_DAY; // Approximate
const MS_PER_YEAR = 365 * MS_PER_DAY;

export function isValidGitUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  const patterns = [
    /^https?:\/\/.+\/.+$/,  // HTTPS URLs
    /^git@[^:]+:.+$/,       // SSH URLs (git@host:path)
    /^ssh:\/\/.+\/.+$/,     // SSH URLs (ssh://host/path)
  ];

  return patterns.some(p => p.test(url));
}

export function extractRepoName(gitUrl: string): string {
  // Remove .git suffix if present
  const cleanUrl = gitUrl.replace(/\.git$/, "");

  // Handle SSH URLs (git@...)
  if (cleanUrl.startsWith("git@")) {
    const parts = cleanUrl.split(":");
    if (parts.length < 2) {
      throw new Error(`Invalid SSH URL format: ${gitUrl}`);
    }
    const urlPath = parts[parts.length - 1];
    const repoName = path.basename(urlPath);
    if (!repoName || repoName === "." || repoName === "..") {
      throw new Error(`Could not extract valid repository name from: ${gitUrl}`);
    }
    return repoName;
  }

  // Handle HTTPS URLs
  if (cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://")) {
    const repoName = path.basename(cleanUrl);
    if (!repoName || repoName === "." || repoName === "..") {
      throw new Error(`Could not extract valid repository name from: ${gitUrl}`);
    }
    return repoName;
  }

  // Handle local paths or simple names
  const repoName = path.basename(cleanUrl);
  if (!repoName || repoName === "." || repoName === "..") {
    throw new Error(`Could not extract valid repository name from: ${gitUrl}`);
  }

  return repoName;
}

/**
 * Normalize human-friendly duration strings to ISO 8601 format.
 * Accepts formats like: 30d, 2w, 6M, 1y, 12h, 30m
 * Returns ISO 8601 format: P30D, P2W, P6M, P1Y, PT12H, PT30M
 * Note: Uppercase M = months, lowercase m = minutes
 */
export function normalizeDuration(durationStr: string): string {
  if (!durationStr || durationStr.trim() === '') {
    return durationStr;
  }

  const normalized = durationStr.trim();
  
  // If it already starts with 'P', assume it's ISO 8601 format
  if (normalized.toUpperCase().startsWith('P')) {
    return normalized;
  }

  // Match patterns like: 30d, 2w, 6M, 1y, 12h, 30m
  // Note: M (uppercase) = months, m (lowercase) = minutes
  // Case-insensitive match, but we preserve the M/m distinction
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([dDwWMmyYhHsS])$/);
  if (!match) {
    // Return as-is if format doesn't match - let parseDuration handle error
    return normalized;
  }

  const [, value, unit] = match;

  // Map human-friendly units to ISO 8601 format
  // Time units (h, H, m, s, S) need PT prefix
  // Date units (d, D, w, W, M, y, Y) need P prefix
  let iso8601Unit: string;
  let isTimeUnit: boolean;
  
  switch (unit) {
    case 'd':
    case 'D':
      iso8601Unit = 'D';
      isTimeUnit = false;
      break;
    case 'w':
    case 'W':
      iso8601Unit = 'W';
      isTimeUnit = false;
      break;
    case 'M':  // Uppercase M = months
      iso8601Unit = 'M';
      isTimeUnit = false;
      break;
    case 'y':
    case 'Y':
      iso8601Unit = 'Y';
      isTimeUnit = false;
      break;
    case 'h':
    case 'H':
      iso8601Unit = 'H';
      isTimeUnit = true;
      break;
    case 'm':  // Lowercase m = minutes
      iso8601Unit = 'M';
      isTimeUnit = true;
      break;
    case 's':
    case 'S':
      iso8601Unit = 'S';
      isTimeUnit = true;
      break;
    default:
      return normalized;
  }

  // Time units need PT prefix, date units need P prefix
  if (isTimeUnit) {
    return `PT${value}${iso8601Unit}`;
  } else {
    return `P${value}${iso8601Unit}`;
  }
}

/**
 * Parse ISO 8601 duration string to milliseconds.
 * Supports: P[n]Y[n]M[n]W[n]DT[n]H[n]M[n]S
 */
function parseISO8601Duration(iso: string): number {
  const upper = iso.toUpperCase();

  // Must start with P
  if (!upper.startsWith('P')) {
    return 0;
  }

  let totalMs = 0;
  const remaining = upper.slice(1);

  // Split into date and time parts
  const tIndex = remaining.indexOf('T');
  const datePart = tIndex >= 0 ? remaining.slice(0, tIndex) : remaining;
  const timePart = tIndex >= 0 ? remaining.slice(tIndex + 1) : '';

  // Parse date part: [n]Y[n]M[n]W[n]D
  const datePattern = /(\d+(?:\.\d+)?)(Y|M|W|D)/g;
  let match;
  while ((match = datePattern.exec(datePart)) !== null) {
    const value = parseFloat(match[1]);
    const unit = match[2];
    switch (unit) {
      case 'Y': totalMs += value * MS_PER_YEAR; break;
      case 'M': totalMs += value * MS_PER_MONTH; break;
      case 'W': totalMs += value * MS_PER_WEEK; break;
      case 'D': totalMs += value * MS_PER_DAY; break;
    }
  }

  // Parse time part: [n]H[n]M[n]S
  const timePattern = /(\d+(?:\.\d+)?)(H|M|S)/g;
  while ((match = timePattern.exec(timePart)) !== null) {
    const value = parseFloat(match[1]);
    const unit = match[2];
    switch (unit) {
      case 'H': totalMs += value * MS_PER_HOUR; break;
      case 'M': totalMs += value * MS_PER_MINUTE; break;
      case 'S': totalMs += value * MS_PER_SECOND; break;
    }
  }

  return totalMs;
}

export function parseDuration(durationStr: string): number {
  if (!durationStr || durationStr.trim() === '') {
    throw new Error('Duration cannot be empty (use formats like: 30d, 2w, 6M, 1y, 12h, 30m or ISO 8601 like P30D, P1Y, P2W, PT1H)');
  }

  // Normalize human-friendly format to ISO 8601
  const normalized = normalizeDuration(durationStr);

  const ms = parseISO8601Duration(normalized);
  if (ms > 0) {
    return ms;
  }

  throw new Error(
    `Invalid duration format: ${durationStr} (use formats like: 30d, 2w, 6M, 1y, 12h, 30m or ISO 8601 like P30D, P1Y, P2W, PT1H)`,
  );
}

export function formatCreatedTime(date: Date): string {
  if (!date || date.getTime() === 0) {
    return "unknown";
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const hours = diffMs / (1000 * 60 * 60);

  if (hours < 1) {
    const minutes = Math.floor(diffMs / (1000 * 60));
    const unit = minutes === 1 ? "minute" : "minutes";
    return `${minutes} ${unit} ago`;
  } else if (hours < 24) {
    const count = Math.floor(hours);
    const unit = count === 1 ? "hour" : "hours";
    return `${count} ${unit} ago`;
  } else if (hours < 24 * 7) {
    const days = Math.floor(hours / 24);
    const unit = days === 1 ? "day" : "days";
    return `${days} ${unit} ago`;
  } else if (hours < 24 * 30) {
    const weeks = Math.floor(hours / (24 * 7));
    const unit = weeks === 1 ? "week" : "weeks";
    return `${weeks} ${unit} ago`;
  } else {
    return date.toISOString().split("T")[0]; // YYYY-MM-DD format
  }
}

export function formatPathWithTilde(filePath: string): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir && filePath.startsWith(homeDir)) {
    // Only replace if the path is exactly homeDir or followed by a path separator
    if (filePath === homeDir || filePath[homeDir.length] === '/') {
      return filePath.replace(homeDir, '~');
    }
  }
  return filePath;
}

// ============================================================================
// Grove Repository Discovery
// ============================================================================

export class GroveDiscoveryError extends Error {
  constructor(message: string, public readonly isRegularGitRepo: boolean = false) {
    super(message);
    this.name = 'GroveDiscoveryError';
  }
}

/**
 * Parse a .git file (used by worktrees) to extract the gitdir path.
 * Worktree .git files contain: "gitdir: /path/to/repo.git/worktrees/branch-name"
 */
export async function parseGitFile(gitFilePath: string): Promise<string> {
  const content = await readFile(gitFilePath, 'utf-8');
  const match = content.trim().match(/^gitdir:\s*(.+)$/);
  if (!match) {
    throw new Error(`Invalid .git file format at ${gitFilePath}`);
  }
  return match[1];
}

/**
 * Extract the bare clone path from a worktree gitdir path.
 * Worktree gitdir format: /path/to/repo.git/worktrees/branch-name
 * Returns: /path/to/repo.git
 *
 * Note: We look for the pattern ".git/worktrees/" to handle edge cases
 * where the branch name itself might contain "worktrees".
 */
export function extractBareCloneFromGitdir(gitdirPath: string): string {
  // Look for .git/worktrees/ pattern (the git-internal worktrees directory)
  // This handles edge cases where branch names contain "worktrees"
  const gitWorktreesPattern = '.git/worktrees/';
  const gitWorktreesIndex = gitdirPath.indexOf(gitWorktreesPattern);

  if (gitWorktreesIndex !== -1) {
    // Found .git/worktrees/ - return everything up to and including .git
    return gitdirPath.substring(0, gitWorktreesIndex + 4); // +4 for ".git"
  }

  // Handle Windows path separator
  const windowsPattern = '.git\\worktrees\\';
  const windowsIndex = gitdirPath.indexOf(windowsPattern);

  if (windowsIndex !== -1) {
    return gitdirPath.substring(0, windowsIndex + 4);
  }

  // Fallback: try simple /worktrees/ pattern for non-standard paths
  const worktreesIndex = gitdirPath.indexOf('/worktrees/');
  if (worktreesIndex !== -1) {
    return gitdirPath.substring(0, worktreesIndex);
  }

  const windowsFallbackIndex = gitdirPath.indexOf('\\worktrees\\');
  if (windowsFallbackIndex !== -1) {
    return gitdirPath.substring(0, windowsFallbackIndex);
  }

  throw new Error(`Invalid worktree gitdir path: ${gitdirPath}`);
}

/**
 * Check if a path is a bare git repository using git commands.
 * Note: This can give false positives when run from within a worktree,
 * so use isBareRepoByStructure for discovery optimization.
 */
async function isBareRepository(repoPath: string): Promise<boolean> {
  try {
    const git = simpleGit({ baseDir: repoPath });
    const configResult = await git.raw(["config", "--get", "core.bare"]);
    return configResult.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Check if a path looks like a bare git repository by examining its structure.
 * This is used for discovery optimization because git commands run from within
 * a worktree will incorrectly report the linked bare repo's config.
 *
 * A bare repo has HEAD, refs/, and objects/ directly in the directory,
 * with no .git file or directory.
 */
async function isBareRepoByStructure(repoPath: string): Promise<boolean> {
  try {
    const headPath = path.join(repoPath, "HEAD");
    const refsPath = path.join(repoPath, "refs");
    const objectsPath = path.join(repoPath, "objects");
    const gitPath = path.join(repoPath, ".git");

    // Must NOT have a .git file or directory (that would be a worktree or regular repo)
    try {
      await stat(gitPath);
      return false; // Has .git, not a bare repo
    } catch {
      // Good, no .git
    }

    // Must have HEAD file
    const headStats = await stat(headPath);
    if (!headStats.isFile()) {
      return false;
    }

    // Must have refs directory
    const refsStats = await stat(refsPath);
    if (!refsStats.isDirectory()) {
      return false;
    }

    // Must have objects directory
    const objectsStats = await stat(objectsPath);
    if (!objectsStats.isDirectory()) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a path contains a .git FILE (worktree) vs a .git DIRECTORY (regular repo).
 * Returns: { isWorktree: boolean, gitPath: string | null }
 */
async function checkGitIndicator(dirPath: string): Promise<{ isWorktree: boolean; isRegularRepo: boolean; gitPath: string | null }> {
  const gitPath = path.join(dirPath, '.git');

  try {
    const stats = await stat(gitPath);
    if (stats.isFile()) {
      // .git FILE = worktree
      return { isWorktree: true, isRegularRepo: false, gitPath };
    } else if (stats.isDirectory()) {
      // .git DIRECTORY = regular repo (or could be submodule)
      return { isWorktree: false, isRegularRepo: true, gitPath };
    }
  } catch {
    // No .git at this path
  }

  return { isWorktree: false, isRegularRepo: false, gitPath: null };
}

/**
 * Discover the bare clone repository from the current working directory.
 *
 * Discovery algorithm:
 * 1. Check for GROVE_REPO environment variable
 * 2. Check if current directory is a bare clone
 * 3. Look for .git FILE (worktree indicator) in current dir or ancestors
 * 4. Skip over .git DIRECTORIES (submodules/regular repos)
 * 5. Verify the linked repository is a bare clone
 *
 * @returns The absolute path to the bare clone repository
 * @throws GroveDiscoveryError if no grove repository is found
 */
export async function discoverBareClone(startPath?: string): Promise<string> {
  // 1. Check for GROVE_REPO environment variable
  const envRepo = process.env.GROVE_REPO;
  if (envRepo) {
    // Validate that GROVE_REPO points to a valid bare clone
    if (await isBareRepository(envRepo)) {
      return envRepo;
    }
    // Invalid GROVE_REPO - clear it and continue with discovery
    delete process.env.GROVE_REPO;
  }

  // Resolve symlinks for the starting path
  let currentPath: string;
  try {
    currentPath = await realpath(startPath || process.cwd());
  } catch {
    currentPath = startPath || process.cwd();
  }

  // 2. Check if current directory is a bare clone (optimization)
  // We check for bare repo structure (HEAD, refs, objects files/dirs directly in the directory)
  // rather than using git commands, because git commands from anywhere inside a worktree
  // will operate on the linked bare repo and report core.bare=true incorrectly
  if (await isBareRepoByStructure(currentPath)) {
    return currentPath;
  }

  // 3 & 4. Traverse up looking for .git FILE (worktree indicator)
  const root = path.parse(currentPath).root;
  let searchPath = currentPath;
  let foundRegularRepo = false;
  let regularRepoPath: string | null = null;

  while (searchPath !== root) {
    const gitCheck = await checkGitIndicator(searchPath);

    if (gitCheck.isWorktree && gitCheck.gitPath) {
      // Found a .git FILE - this is a worktree
      try {
        const gitdirPath = await parseGitFile(gitCheck.gitPath);

        // Resolve the gitdir path (it might be relative)
        const resolvedGitdir = path.isAbsolute(gitdirPath)
          ? gitdirPath
          : path.resolve(searchPath, gitdirPath);

        // Extract bare clone path
        const bareClonePath = extractBareCloneFromGitdir(resolvedGitdir);

        // Verify it's actually a bare clone
        if (await isBareRepository(bareClonePath)) {
          return bareClonePath;
        }
      } catch {
        // Invalid .git file, continue searching
      }
    } else if (gitCheck.isRegularRepo) {
      // Found a .git DIRECTORY - this is a regular repo or submodule
      // Remember this for error messaging, but continue traversing up
      // to find a grove worktree
      if (!foundRegularRepo) {
        foundRegularRepo = true;
        regularRepoPath = searchPath;
      }
    }

    // Move up to parent directory
    searchPath = path.dirname(searchPath);
  }

  // 6. No grove repository found
  if (foundRegularRepo) {
    throw new GroveDiscoveryError(
      `This is a git repository but not a grove-managed worktree setup.\n` +
      `Grove requires a bare clone with worktrees. Run \`grove init <git-url>\` in a different directory to create a new grove setup.`,
      true
    );
  }

  throw new GroveDiscoveryError(
    `Not in a grove repository.\nRun \`grove init <git-url>\` to create one.`
  );
}

/**
 * Quick check to determine if the current directory is inside a grove-managed repository.
 * Used by init command to prevent nested grove repositories.
 *
 * Optimization: First checks for a .git file in current directory (fast path for worktrees),
 * then falls back to full discovery if needed.
 *
 * @returns The path to the grove repository if found, null otherwise
 */
export async function findGroveRepo(startPath?: string): Promise<string | null> {
  const searchPath = startPath || process.cwd();

  // Quick check: look for .git file in current directory (worktree indicator)
  const gitPath = path.join(searchPath, '.git');
  try {
    const stats = await stat(gitPath);
    if (stats.isFile()) {
      // Found a .git file - this is likely a worktree, do full discovery
      return await discoverBareClone(startPath);
    }
    // .git directory means regular repo - but could still be inside a grove hierarchy
    // Fall through to full discovery
  } catch {
    // No .git at all - might still be nested inside a grove hierarchy
  }

  // Full discovery (only if quick check didn't find anything definitive)
  try {
    return await discoverBareClone(startPath);
  } catch {
    return null;
  }
}

/**
 * Get the project root directory (parent of the bare clone).
 * This is where all worktrees should be created.
 */
export function getProjectRoot(bareClonePath: string): string {
  return path.dirname(bareClonePath);
}
