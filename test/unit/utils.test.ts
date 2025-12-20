import { describe, test, expect } from "bun:test";
import {
  extractRepoName,
  parseDuration,
  formatCreatedTime,
  formatPathWithTilde,
  isValidGitUrl,
} from "../../src/utils/index";

describe("extractRepoName", () => {
  describe("HTTPS URLs", () => {
    test("should extract repo name from standard HTTPS URL", () => {
      expect(extractRepoName("https://github.com/user/my-repo.git")).toBe(
        "my-repo"
      );
    });

    test("should extract repo name from HTTPS URL without .git suffix", () => {
      expect(extractRepoName("https://github.com/user/my-repo")).toBe(
        "my-repo"
      );
    });

    test("should handle GitLab HTTPS URLs", () => {
      expect(extractRepoName("https://gitlab.com/org/project.git")).toBe(
        "project"
      );
    });

    test("should handle Bitbucket HTTPS URLs", () => {
      expect(extractRepoName("https://bitbucket.org/team/repo-name.git")).toBe(
        "repo-name"
      );
    });

    test("should handle self-hosted Git URLs with ports", () => {
      expect(
        extractRepoName("https://git.company.com:8443/team/project.git")
      ).toBe("project");
    });

    test("should handle nested paths in HTTPS URLs", () => {
      expect(
        extractRepoName("https://github.com/org/group/subgroup/repo.git")
      ).toBe("repo");
    });
  });

  describe("SSH URLs", () => {
    test("should extract repo name from standard SSH URL", () => {
      expect(extractRepoName("git@github.com:user/my-repo.git")).toBe(
        "my-repo"
      );
    });

    test("should extract repo name from SSH URL without .git suffix", () => {
      expect(extractRepoName("git@github.com:user/my-repo")).toBe("my-repo");
    });

    test("should handle GitLab SSH URLs", () => {
      expect(extractRepoName("git@gitlab.com:org/project.git")).toBe("project");
    });

    test("should handle nested paths in SSH URLs", () => {
      expect(extractRepoName("git@github.com:org/group/repo.git")).toBe("repo");
    });

    test("should handle SSH URLs with custom ports", () => {
      expect(extractRepoName("git@git.company.com:team/project.git")).toBe(
        "project"
      );
    });
  });

  describe("Local paths", () => {
    test("should extract repo name from local path", () => {
      expect(extractRepoName("/home/user/projects/my-repo")).toBe("my-repo");
    });

    test("should extract repo name from local path with .git suffix", () => {
      expect(extractRepoName("/home/user/projects/my-repo.git")).toBe(
        "my-repo"
      );
    });

    test("should extract repo name from relative path", () => {
      expect(extractRepoName("./my-repo.git")).toBe("my-repo");
    });

    test("should handle simple repo name", () => {
      expect(extractRepoName("my-repo")).toBe("my-repo");
    });
  });

  describe("Special characters in repo names", () => {
    test("should handle repo names with hyphens", () => {
      expect(extractRepoName("https://github.com/user/my-awesome-repo.git")).toBe(
        "my-awesome-repo"
      );
    });

    test("should handle repo names with underscores", () => {
      expect(extractRepoName("https://github.com/user/my_repo.git")).toBe(
        "my_repo"
      );
    });

    test("should handle repo names with dots", () => {
      expect(extractRepoName("https://github.com/user/my.repo.git")).toBe(
        "my.repo"
      );
    });

    test("should handle repo names with numbers", () => {
      expect(extractRepoName("https://github.com/user/repo123.git")).toBe(
        "repo123"
      );
    });

    test("should handle mixed special characters", () => {
      expect(extractRepoName("git@github.com:user/My_Repo-v2.0.git")).toBe(
        "My_Repo-v2.0"
      );
    });
  });

  describe("Error cases", () => {
    test("should throw error for empty string", () => {
      expect(() => extractRepoName("")).toThrow(
        "Could not extract valid repository name"
      );
    });

    test("should throw error for just .git", () => {
      expect(() => extractRepoName(".git")).toThrow(
        "Could not extract valid repository name"
      );
    });

    test("should throw error for invalid SSH URL format", () => {
      expect(() => extractRepoName("git@")).toThrow("Invalid SSH URL format");
    });

    test("should throw error for dot path", () => {
      expect(() => extractRepoName(".")).toThrow(
        "Could not extract valid repository name"
      );
    });

    test("should throw error for double-dot path traversal", () => {
      expect(() => extractRepoName("https://github.com/user/..")).toThrow(
        "Could not extract valid repository name"
      );
    });

    test("should throw error for double-dot in SSH URL", () => {
      expect(() => extractRepoName("git@github.com:user/..")).toThrow(
        "Could not extract valid repository name"
      );
    });
  });
});

describe("isValidGitUrl", () => {
  describe("Valid URLs", () => {
    test("should accept standard HTTPS URL", () => {
      expect(isValidGitUrl("https://github.com/user/repo.git")).toBe(true);
    });

    test("should accept HTTPS URL without .git", () => {
      expect(isValidGitUrl("https://github.com/user/repo")).toBe(true);
    });

    test("should accept SSH URL with git@", () => {
      expect(isValidGitUrl("git@github.com:user/repo.git")).toBe(true);
    });

    test("should accept ssh:// URL", () => {
      expect(isValidGitUrl("ssh://git@github.com/user/repo.git")).toBe(true);
    });

    test("should accept HTTP URL", () => {
      expect(isValidGitUrl("http://github.com/user/repo")).toBe(true);
    });
  });

  describe("Invalid URLs", () => {
    test("should reject empty string", () => {
      expect(isValidGitUrl("")).toBe(false);
    });

    test("should reject null", () => {
      expect(isValidGitUrl(null as any)).toBe(false);
    });

    test("should reject undefined", () => {
      expect(isValidGitUrl(undefined as any)).toBe(false);
    });

    test("should reject local paths", () => {
      expect(isValidGitUrl("/path/to/repo")).toBe(false);
    });

    test("should reject relative paths", () => {
      expect(isValidGitUrl("./repo")).toBe(false);
    });

    test("should reject file:// URLs", () => {
      expect(isValidGitUrl("file:///path/to/repo")).toBe(false);
    });

    test("should reject plain repo names", () => {
      expect(isValidGitUrl("my-repo")).toBe(false);
    });

    test("should reject malformed SSH URLs", () => {
      expect(isValidGitUrl("git@github.com")).toBe(false);
    });
  });
});

describe("parseDuration", () => {
  describe("Valid ISO 8601 durations", () => {
    test("should parse days (P30D)", () => {
      const result = parseDuration("P30D");
      expect(result).toBe(30 * 24 * 60 * 60 * 1000);
    });

    test("should parse weeks (P2W)", () => {
      const result = parseDuration("P2W");
      expect(result).toBe(14 * 24 * 60 * 60 * 1000);
    });

    test("should parse years (P1Y)", () => {
      const result = parseDuration("P1Y");
      expect(result).toBe(365 * 24 * 60 * 60 * 1000);
    });

    test("should parse months (P3M)", () => {
      const result = parseDuration("P3M");
      // Moment calculates months more precisely, approximately 91 days for 3 months
      expect(result).toBeGreaterThan(7700000000);
      expect(result).toBeLessThan(8000000000);
    });

    test("should parse hours (PT1H)", () => {
      const result = parseDuration("PT1H");
      expect(result).toBe(60 * 60 * 1000);
    });

    test("should parse minutes (PT30M)", () => {
      const result = parseDuration("PT30M");
      expect(result).toBe(30 * 60 * 1000);
    });

    test("should parse complex duration (P1DT12H)", () => {
      const result = parseDuration("P1DT12H");
      expect(result).toBe(36 * 60 * 60 * 1000);
    });

    test("should handle lowercase input", () => {
      const result = parseDuration("p30d");
      expect(result).toBe(30 * 24 * 60 * 60 * 1000);
    });
  });

  describe("Error cases", () => {
    test("should throw for empty string", () => {
      expect(() => parseDuration("")).toThrow("Duration cannot be empty");
    });

    test("should throw for whitespace-only string", () => {
      expect(() => parseDuration("   ")).toThrow("Duration cannot be empty");
    });

    test("should throw for invalid format", () => {
      expect(() => parseDuration("30 days")).toThrow("Invalid duration format");
    });

    test("should throw for zero duration", () => {
      expect(() => parseDuration("P0D")).toThrow();
    });

    test("should throw for negative values", () => {
      expect(() => parseDuration("P-30D")).toThrow();
    });
  });
});

describe("formatCreatedTime", () => {
  test("should return 'unknown' for epoch date", () => {
    const epochDate = new Date(0);
    expect(formatCreatedTime(epochDate)).toBe("unknown");
  });

  test("should return 'unknown' for invalid date", () => {
    expect(formatCreatedTime(null as any)).toBe("unknown");
  });

  test("should show minutes for times less than 1 hour ago", () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    expect(formatCreatedTime(thirtyMinutesAgo)).toBe("30 minutes ago");
  });

  test("should show hours for times less than 24 hours ago", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(formatCreatedTime(twoHoursAgo)).toBe("2 hours ago");
  });

  test("should show days for times less than 7 days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatCreatedTime(threeDaysAgo)).toBe("3 days ago");
  });

  test("should show weeks for times less than 30 days ago", () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    expect(formatCreatedTime(twoWeeksAgo)).toBe("2 weeks ago");
  });

  test("should show ISO date for older times", () => {
    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const result = formatCreatedTime(twoMonthsAgo);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatPathWithTilde", () => {
  test("should replace home directory with tilde", () => {
    const home = process.env.HOME || "/home/user";
    const result = formatPathWithTilde(`${home}/projects/grove`);
    expect(result).toBe("~/projects/grove");
  });

  test("should return path unchanged if not in home directory", () => {
    const result = formatPathWithTilde("/tmp/projects/grove");
    expect(result).toBe("/tmp/projects/grove");
  });

  test("should handle exact home directory path", () => {
    const home = process.env.HOME || "/home/user";
    const result = formatPathWithTilde(home);
    expect(result).toBe("~");
  });

  test("should not replace partial matches", () => {
    // If HOME is /home/user, should not match /home/user2
    const home = process.env.HOME || "/home/user";
    const result = formatPathWithTilde(`${home}2/projects`);
    // Should not replace since it's not followed by a path separator
    expect(result).toBe(`${home}2/projects`);
  });
});
