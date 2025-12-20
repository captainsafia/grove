import * as path from "path";
import moment from "moment";
import chalk from "chalk";

/**
 * Unified error formatting helper for consistent CLI error messages
 */
export function formatError(message: string, hint?: string): void {
  console.error(chalk.red('Error:'), message);
  if (hint) {
    console.error(chalk.yellow('  Hint:'), hint);
  }
}

/**
 * Format and print a warning message
 */
export function formatWarning(message: string): void {
  console.warn(chalk.yellow('Warning:'), message);
}

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

export function parseDuration(durationStr: string): number {
  if (!durationStr || durationStr.trim() === '') {
    throw new Error('Duration cannot be empty (use ISO 8601 duration format like P30D, P1Y, P2W, PT1H)');
  }

  try {
    const duration = moment.duration(durationStr.toUpperCase());
    if (duration.asMilliseconds() > 0) {
      return duration.asMilliseconds();
    } else {
      throw new Error(`Invalid or zero duration: ${durationStr}`);
    }
  } catch (error) {
    throw new Error(
      `Invalid duration format: ${durationStr} (use ISO 8601 duration format like P30D, P1Y, P2W, PT1H)`,
    );
  }
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
    return `${minutes} minutes ago`;
  } else if (hours < 24) {
    return `${Math.floor(hours)} hours ago`;
  } else if (hours < 24 * 7) {
    const days = Math.floor(hours / 24);
    return `${days} days ago`;
  } else if (hours < 24 * 30) {
    const weeks = Math.floor(hours / (24 * 7));
    return `${weeks} weeks ago`;
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
