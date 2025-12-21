import * as path from "path";

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
