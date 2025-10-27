import * as path from "path";
import moment from "moment";

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
    if (!repoName || repoName === ".") {
      throw new Error(`Could not extract repository name from: ${gitUrl}`);
    }
    return repoName;
  }

  // Handle HTTPS URLs
  if (cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://")) {
    const repoName = path.basename(cleanUrl);
    if (!repoName || repoName === ".") {
      throw new Error(`Could not extract repository name from: ${gitUrl}`);
    }
    return repoName;
  }

  // Handle local paths or simple names
  const repoName = path.basename(cleanUrl);
  if (!repoName || repoName === ".") {
    throw new Error(`Could not extract repository name from: ${gitUrl}`);
  }

  return repoName;
}

export function parseDuration(durationStr: string): number {
  if (!durationStr) return 0;

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
