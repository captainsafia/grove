import { describe, test, expect, beforeEach, mock, Mock } from "bun:test";
import { WorktreeManager } from "../../src/git/WorktreeManager";

// Mock simple-git for edge case testing
mock.module("simple-git", () => ({
  simpleGit: () => mockGit,
}));

let mockGit: {
  raw: Mock<(...args: any[]) => Promise<string>>;
  status: Mock<(...args: any[]) => Promise<any>>;
  clone: Mock<(...args: any[]) => Promise<any>>;
  addConfig: Mock<(...args: any[]) => Promise<any>>;
};

describe("WorktreeManager Edge Cases", () => {
  let manager: WorktreeManager;

  beforeEach(() => {
    mockGit = {
      raw: mock(() => Promise.resolve("")),
      status: mock(() => Promise.resolve({ isClean: () => true })),
      clone: mock(() => Promise.resolve({})),
      addConfig: mock(() => Promise.resolve({})),
    };

    manager = new WorktreeManager();
  });

  describe("Branch names with special characters", () => {
    test("should handle branch names with slashes (feature/my-feature)", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve("abc123"));

      const result = await manager.branchExists("feature/my-feature");

      expect(result).toBe(true);
      expect(mockGit.raw).toHaveBeenCalledWith([
        "rev-parse",
        "--verify",
        "refs/heads/feature/my-feature",
      ]);
    });

    test("should handle branch names with multiple slashes", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve("abc123"));

      const result = await manager.branchExists("feature/team/task-123");

      expect(result).toBe(true);
      expect(mockGit.raw).toHaveBeenCalledWith([
        "rev-parse",
        "--verify",
        "refs/heads/feature/team/task-123",
      ]);
    });

    test("should handle branch names with dots", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve("abc123"));

      const result = await manager.branchExists("release/v1.2.3");

      expect(result).toBe(true);
      expect(mockGit.raw).toHaveBeenCalledWith([
        "rev-parse",
        "--verify",
        "refs/heads/release/v1.2.3",
      ]);
    });

    test("should handle branch names with underscores", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve("abc123"));

      const result = await manager.branchExists("feature_my_feature");

      expect(result).toBe(true);
      expect(mockGit.raw).toHaveBeenCalledWith([
        "rev-parse",
        "--verify",
        "refs/heads/feature_my_feature",
      ]);
    });

    test("should handle branch names with hyphens", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve("abc123"));

      const result = await manager.branchExists("my-awesome-feature-branch");

      expect(result).toBe(true);
    });

    test("should handle branch names with numbers only", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve("abc123"));

      const result = await manager.branchExists("12345");

      expect(result).toBe(true);
      expect(mockGit.raw).toHaveBeenCalledWith([
        "rev-parse",
        "--verify",
        "refs/heads/12345",
      ]);
    });
  });

  describe("Unicode branch names", () => {
    test("should handle branch names with unicode characters", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve("abc123"));

      const result = await manager.branchExists("feature/日本語");

      expect(result).toBe(true);
      expect(mockGit.raw).toHaveBeenCalledWith([
        "rev-parse",
        "--verify",
        "refs/heads/feature/日本語",
      ]);
    });

    test("should handle branch names with emojis", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve("abc123"));

      const result = await manager.branchExists("feature/🚀-rocket");

      expect(result).toBe(true);
    });

    test("should handle branch names with accented characters", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve("abc123"));

      const result = await manager.branchExists("feature/café-update");

      expect(result).toBe(true);
    });

    test("should handle branch names with Cyrillic characters", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve("abc123"));

      const result = await manager.branchExists("feature/тест");

      expect(result).toBe(true);
    });
  });

  describe("Very long branch names", () => {
    test("should handle 100-character branch names", async () => {
      const longBranchName = "feature/" + "a".repeat(92); // 100 chars total
      mockGit.raw.mockImplementation(() => Promise.resolve("abc123"));

      const result = await manager.branchExists(longBranchName);

      expect(result).toBe(true);
      expect(mockGit.raw).toHaveBeenCalledWith([
        "rev-parse",
        "--verify",
        `refs/heads/${longBranchName}`,
      ]);
    });

    test("should handle 200-character branch names", async () => {
      const longBranchName = "feature/" + "b".repeat(192);
      mockGit.raw.mockImplementation(() => Promise.resolve("abc123"));

      const result = await manager.branchExists(longBranchName);

      expect(result).toBe(true);
    });

    test("should handle branch names with long path components", async () => {
      const longBranchName = "feature/team/project/task/" + "c".repeat(100);
      mockGit.raw.mockImplementation(() => Promise.resolve("abc123"));

      const result = await manager.branchExists(longBranchName);

      expect(result).toBe(true);
    });
  });

  describe("Worktree states", () => {
    test("should parse locked worktree from porcelain output", async () => {
      const porcelainOutput = `worktree /path/to/worktree
HEAD abc123def456
branch refs/heads/feature-branch
locked

`;
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "worktree" && args[1] === "list") {
          return Promise.resolve(porcelainOutput);
        }
        return Promise.resolve("");
      });

      // This tests the parseWorktreeList internal method indirectly
      const worktrees = await manager.listWorktrees();

      expect(worktrees[0].isLocked).toBe(true);
    });

    test("should parse prunable worktree from porcelain output", async () => {
      const porcelainOutput = `worktree /path/to/worktree
HEAD abc123def456
branch refs/heads/stale-branch
prunable

`;
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "worktree" && args[1] === "list") {
          return Promise.resolve(porcelainOutput);
        }
        return Promise.resolve("");
      });

      const worktrees = await manager.listWorktrees();

      expect(worktrees[0].isPrunable).toBe(true);
    });

    test("should parse detached HEAD worktree", async () => {
      const porcelainOutput = `worktree /path/to/worktree
HEAD abc123def456
detached

`;
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "worktree" && args[1] === "list") {
          return Promise.resolve(porcelainOutput);
        }
        return Promise.resolve("");
      });

      const worktrees = await manager.listWorktrees();

      expect(worktrees[0].branch).toBe("detached HEAD");
    });

    test("should correctly identify main branch worktrees", async () => {
      const porcelainOutput = `worktree /path/to/main-worktree
HEAD abc123def456
branch refs/heads/main

`;
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "worktree" && args[1] === "list") {
          return Promise.resolve(porcelainOutput);
        }
        return Promise.resolve("");
      });

      const worktrees = await manager.listWorktrees();

      expect(worktrees[0].isMain).toBe(true);
      expect(worktrees[0].branch).toBe("main");
    });

    test("should correctly identify master branch worktrees", async () => {
      const porcelainOutput = `worktree /path/to/master-worktree
HEAD abc123def456
branch refs/heads/master

`;
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "worktree" && args[1] === "list") {
          return Promise.resolve(porcelainOutput);
        }
        return Promise.resolve("");
      });

      const worktrees = await manager.listWorktrees();

      expect(worktrees[0].isMain).toBe(true);
      expect(worktrees[0].branch).toBe("master");
    });

    test("should skip bare repository worktrees", async () => {
      const porcelainOutput = `worktree /path/to/bare-repo
bare

worktree /path/to/regular-worktree
HEAD abc123def456
branch refs/heads/feature

`;
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "worktree" && args[1] === "list") {
          return Promise.resolve(porcelainOutput);
        }
        return Promise.resolve("");
      });

      const worktrees = await manager.listWorktrees();

      expect(worktrees.length).toBe(1);
      expect(worktrees[0].branch).toBe("feature");
    });

    test("should parse multiple worktrees correctly", async () => {
      const porcelainOutput = `worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/feature1
HEAD def456
branch refs/heads/feature/one
locked

worktree /path/to/feature2
HEAD 789abc
branch refs/heads/feature/two
prunable

`;
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "worktree" && args[1] === "list") {
          return Promise.resolve(porcelainOutput);
        }
        return Promise.resolve("");
      });

      const worktrees = await manager.listWorktrees();

      expect(worktrees.length).toBe(3);
      expect(worktrees[0].isMain).toBe(true);
      expect(worktrees[1].isLocked).toBe(true);
      expect(worktrees[2].isPrunable).toBe(true);
    });
  });

  describe("isBranchMerged edge cases", () => {
    test("should handle branches with special characters in merge check", async () => {
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "branch" && args[1] === "--merged") {
          return Promise.resolve("  main\n  feature/special-chars\n  another-branch\n");
        }
        return Promise.resolve("");
      });

      const result = await manager.isBranchMerged("feature/special-chars", "main");

      expect(result).toBe(true);
    });

    test("should handle starred current branch in merge list", async () => {
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "branch" && args[1] === "--merged") {
          return Promise.resolve("* main\n  feature-branch\n");
        }
        return Promise.resolve("");
      });

      const result = await manager.isBranchMerged("main", "main");

      expect(result).toBe(true);
    });

    test("should return false for unmerged branch", async () => {
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "branch" && args[1] === "--merged") {
          return Promise.resolve("  main\n");
        }
        return Promise.resolve("");
      });

      const result = await manager.isBranchMerged("unmerged-feature", "main");

      expect(result).toBe(false);
    });

    test("should handle empty merged branch list", async () => {
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "branch" && args[1] === "--merged") {
          return Promise.resolve("");
        }
        return Promise.resolve("");
      });

      const result = await manager.isBranchMerged("any-branch", "main");

      expect(result).toBe(false);
    });
  });

  describe("addWorktree edge cases", () => {
    test("should create worktree with special characters in path", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve(""));

      await manager.addWorktree("/path/to/my-feature", "feature/my-feature", {
        createBranch: true,
      });

      expect(mockGit.raw).toHaveBeenCalledWith([
        "worktree",
        "add",
        "-b",
        "feature/my-feature",
        "/path/to/my-feature",
      ]);
    });

    test("should handle unicode branch names in addWorktree", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve(""));

      await manager.addWorktree("/path/to/worktree", "feature/日本語", {
        createBranch: true,
      });

      expect(mockGit.raw).toHaveBeenCalledWith([
        "worktree",
        "add",
        "-b",
        "feature/日本語",
        "/path/to/worktree",
      ]);
    });

    test("should handle very long branch name in addWorktree", async () => {
      const longBranch = "feature/" + "x".repeat(200);
      mockGit.raw.mockImplementation(() => Promise.resolve(""));

      await manager.addWorktree("/path/to/worktree", longBranch, {
        createBranch: false,
      });

      expect(mockGit.raw).toHaveBeenCalledWith([
        "worktree",
        "add",
        "/path/to/worktree",
        longBranch,
      ]);
    });
  });

  describe("syncBranch edge cases", () => {
    test("should sync branch with slashes", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve(""));

      await manager.syncBranch("feature/my-feature");

      expect(mockGit.raw).toHaveBeenCalledWith([
        "fetch",
        "origin",
        "feature/my-feature:feature/my-feature",
      ]);
    });

    test("should sync branch with unicode characters", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve(""));

      await manager.syncBranch("feature/日本語");

      expect(mockGit.raw).toHaveBeenCalledWith([
        "fetch",
        "origin",
        "feature/日本語:feature/日本語",
      ]);
    });
  });

  describe("removeWorktree edge cases", () => {
    test("should remove worktree with force option", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve(""));

      await manager.removeWorktree("/path/to/worktree", true);

      expect(mockGit.raw).toHaveBeenCalledWith([
        "worktree",
        "remove",
        "--force",
        "/path/to/worktree",
      ]);
    });

    test("should remove worktree without force option", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve(""));

      await manager.removeWorktree("/path/to/worktree", false);

      expect(mockGit.raw).toHaveBeenCalledWith([
        "worktree",
        "remove",
        "/path/to/worktree",
      ]);
    });

    test("should throw descriptive error on removal failure", async () => {
      mockGit.raw.mockImplementation(() =>
        Promise.reject(new Error("fatal: worktree is dirty"))
      );

      await expect(
        manager.removeWorktree("/path/to/dirty-worktree")
      ).rejects.toThrow("Failed to remove worktree");
    });
  });

  describe("cloneBareRepository edge cases", () => {
    test("should clone and configure bare repository", async () => {
      const mockBareGit = {
        addConfig: mock(() => Promise.resolve({})),
      };

      // Override simpleGit for the bare repo
      mockGit.clone.mockImplementation(() => Promise.resolve({}));

      await manager.cloneBareRepository(
        "https://github.com/user/repo.git",
        "/path/to/bare-repo"
      );

      expect(mockGit.clone).toHaveBeenCalledWith(
        "https://github.com/user/repo.git",
        "/path/to/bare-repo",
        ["--bare"]
      );
    });

    test("should throw descriptive error on clone failure", async () => {
      mockGit.clone.mockImplementation(() =>
        Promise.reject(new Error("fatal: repository not found"))
      );

      await expect(
        manager.cloneBareRepository(
          "https://github.com/user/nonexistent.git",
          "/path/to/repo"
        )
      ).rejects.toThrow("Failed to clone repository");
    });
  });
});
