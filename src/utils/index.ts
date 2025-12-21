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

export function parseDuration(durationStr: string): number {
  if (!durationStr || durationStr.trim() === '') {
    throw new Error('Duration cannot be empty (use formats like: 30d, 2w, 6M, 1y, 12h, 30m or ISO 8601 like P30D, P1Y, P2W, PT1H)');
  }

  // Normalize human-friendly format to ISO 8601
  const normalized = normalizeDuration(durationStr);

  try {
    const duration = moment.duration(normalized.toUpperCase());
    if (duration.asMilliseconds() > 0) {
      return duration.asMilliseconds();
    } else {
      throw new Error(`Invalid or zero duration: ${durationStr}`);
    }
  } catch (error) {
    throw new Error(
      `Invalid duration format: ${durationStr} (use formats like: 30d, 2w, 6M, 1y, 12h, 30m or ISO 8601 like P30D, P1Y, P2W, PT1H)`,
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
