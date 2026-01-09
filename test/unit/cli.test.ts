import { describe, test, expect } from "bun:test";
import * as path from "path";

// Test the getWorktreePath logic from add.ts
// We replicate the function here since it's not exported
function getWorktreePath(branchName: string): string {
  // Validate branch name doesn't contain path traversal
  if (branchName.includes('..') || path.isAbsolute(branchName)) {
    throw new Error('Invalid branch name: contains path traversal characters');
  }

  // Sanitize special characters that could cause issues on various filesystems
  const sanitizedName = branchName.replace(/[<>:"|?*]/g, '-');

  // Get the current working directory
  const cwd = process.cwd();
  const parentDir = path.dirname(cwd);

  // Use the branch name as the directory name
  // Replace slashes with the OS path separator for nested branches
  const dirName = sanitizedName.replace(/\//g, path.sep);

  const worktreePath = path.join(parentDir, dirName);

  // Ensure the resolved path is within the parent directory
  const resolvedPath = path.resolve(worktreePath);
  if (!resolvedPath.startsWith(path.resolve(parentDir) + path.sep) && resolvedPath !== path.resolve(parentDir)) {
    throw new Error('Invalid branch name: would create worktree outside project');
  }

  return resolvedPath;
}

describe("getWorktreePath security", () => {
  describe("path traversal prevention", () => {
    test("should reject branch names with double dots", () => {
      expect(() => getWorktreePath("../malicious")).toThrow(
        "Invalid branch name: contains path traversal characters"
      );
    });

    test("should reject branch names with embedded double dots", () => {
      expect(() => getWorktreePath("feature/../../../etc/passwd")).toThrow(
        "Invalid branch name: contains path traversal characters"
      );
    });

    test("should reject absolute paths on Unix", () => {
      expect(() => getWorktreePath("/etc/passwd")).toThrow(
        "Invalid branch name: contains path traversal characters"
      );
    });

    test("should reject absolute paths on Windows style", () => {
      // This test verifies that path.isAbsolute catches Windows paths
      if (process.platform === 'win32') {
        expect(() => getWorktreePath("C:\\Windows\\System32")).toThrow(
          "Invalid branch name: contains path traversal characters"
        );
      }
    });
  });

  describe("special character sanitization", () => {
    // Note: We check path.basename() because on Windows the full path contains
    // a colon in the drive letter (e.g., "D:\..."), but we only care that the
    // branch name portion is sanitized.

    test("should sanitize angle brackets", () => {
      const result = getWorktreePath("feature<test>");
      const basename = path.basename(result);
      expect(basename).not.toContain("<");
      expect(basename).not.toContain(">");
    });

    test("should sanitize colon", () => {
      const result = getWorktreePath("feature:test");
      const basename = path.basename(result);
      expect(basename).not.toContain(":");
    });

    test("should sanitize quotes", () => {
      const result = getWorktreePath('feature"test');
      const basename = path.basename(result);
      expect(basename).not.toContain('"');
    });

    test("should sanitize pipe", () => {
      const result = getWorktreePath("feature|test");
      const basename = path.basename(result);
      expect(basename).not.toContain("|");
    });

    test("should sanitize question mark", () => {
      const result = getWorktreePath("feature?test");
      const basename = path.basename(result);
      expect(basename).not.toContain("?");
    });

    test("should sanitize asterisk", () => {
      const result = getWorktreePath("feature*test");
      const basename = path.basename(result);
      expect(basename).not.toContain("*");
    });
  });

  describe("valid branch names", () => {
    test("should accept simple branch names", () => {
      const result = getWorktreePath("feature-branch");
      expect(result).toBeTruthy();
      expect(result).toContain("feature-branch");
    });

    test("should accept nested branch names with slashes", () => {
      const result = getWorktreePath("feature/my-feature");
      expect(result).toBeTruthy();
    });

    test("should accept branch names with hyphens and underscores", () => {
      const result = getWorktreePath("feature_branch-name");
      expect(result).toBeTruthy();
    });

    test("should accept branch names with numbers", () => {
      const result = getWorktreePath("feature-123");
      expect(result).toBeTruthy();
    });

    test("should accept deeply nested branch names", () => {
      const result = getWorktreePath("user/feature/sub-feature");
      expect(result).toBeTruthy();
    });
  });
});

describe("self-update validation", () => {
  // PR number validation regex from self-update.ts
  const prRegex = /^\d+$/;
  // Version format regex from self-update.ts
  const versionRegex = /^v?\d+\.\d+\.\d+(-[\w.]+)?$/;

  describe("PR number validation", () => {
    test("should accept valid PR numbers", () => {
      expect(prRegex.test("123")).toBe(true);
      expect(prRegex.test("1")).toBe(true);
      expect(prRegex.test("99999")).toBe(true);
    });

    test("should reject PR numbers with command injection", () => {
      expect(prRegex.test("123; rm -rf /")).toBe(false);
      expect(prRegex.test("123 && malicious")).toBe(false);
      expect(prRegex.test("$(whoami)")).toBe(false);
      expect(prRegex.test("`whoami`")).toBe(false);
    });

    test("should reject non-numeric PR numbers", () => {
      expect(prRegex.test("abc")).toBe(false);
      expect(prRegex.test("12a3")).toBe(false);
      expect(prRegex.test("-123")).toBe(false);
      expect(prRegex.test("12.3")).toBe(false);
    });
  });

  describe("version format validation", () => {
    test("should accept valid version formats", () => {
      expect(versionRegex.test("1.0.0")).toBe(true);
      expect(versionRegex.test("v1.0.0")).toBe(true);
      expect(versionRegex.test("2.10.3")).toBe(true);
      expect(versionRegex.test("v0.0.1")).toBe(true);
    });

    test("should accept versions with prerelease tags", () => {
      expect(versionRegex.test("1.0.0-alpha")).toBe(true);
      expect(versionRegex.test("v1.0.0-beta.1")).toBe(true);
      expect(versionRegex.test("1.0.0-rc.2")).toBe(true);
    });

    test("should reject versions with command injection", () => {
      expect(versionRegex.test("1.0.0; rm -rf /")).toBe(false);
      expect(versionRegex.test("1.0.0 && malicious")).toBe(false);
      expect(versionRegex.test("$(whoami)")).toBe(false);
    });

    test("should reject invalid version formats", () => {
      expect(versionRegex.test("1.0")).toBe(false);
      expect(versionRegex.test("1")).toBe(false);
      expect(versionRegex.test("latest")).toBe(false);
    });
  });
});
