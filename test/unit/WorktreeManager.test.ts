import { describe, test, expect, beforeEach, mock, Mock } from "bun:test";
import { WorktreeManager } from "../../src/git/WorktreeManager";
import type { SimpleGit } from "simple-git";

let mockGit: {
  raw: Mock<(...args: any[]) => Promise<string>>;
  status: Mock<(...args: any[]) => Promise<any>>;
  clone: Mock<(...args: any[]) => Promise<any>>;
  addConfig: Mock<(...args: any[]) => Promise<any>>;
};

// Mock simple-git - supports both simpleGit(options) and simpleGit(path) patterns
mock.module("simple-git", () => ({
  simpleGit: () => mockGit,
}));

describe("WorktreeManager", () => {
  let manager: WorktreeManager;

  beforeEach(() => {
    // Create a mock git instance
    mockGit = {
      raw: mock(() => Promise.resolve("")),
      status: mock(() => Promise.resolve({})),
      clone: mock(() => Promise.resolve({})),
      addConfig: mock(() => Promise.resolve({})),
    };

    manager = new WorktreeManager();
  });

  describe("branchExists", () => {
    test("should return true when a branch exists", async () => {
      // Mock successful rev-parse response
      mockGit.raw.mockImplementation(() => Promise.resolve("abc123def456"));

      const result = await manager.branchExists("feature-branch");

      expect(result).toBe(true);
      expect(mockGit.raw).toHaveBeenCalledWith([
        "rev-parse",
        "--verify",
        "refs/heads/feature-branch",
      ]);
    });

    test("should return false when a branch does not exist", async () => {
      // Mock failed rev-parse response (branch doesn't exist)
      mockGit.raw.mockImplementation(() => Promise.reject(new Error("fatal: Needed a single revision")));

      const result = await manager.branchExists("non-existent-branch");

      expect(result).toBe(false);
      expect(mockGit.raw).toHaveBeenCalledWith([
        "rev-parse",
        "--verify",
        "refs/heads/non-existent-branch",
      ]);
    });
  });

  describe("addWorktree", () => {
    test("should create a new worktree for an existing branch", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve(""));

      await manager.addWorktree("/path/to/worktree", "existing-branch", {
        createBranch: false,
      });

      expect(mockGit.raw).toHaveBeenCalledWith([
        "worktree",
        "add",
        "/path/to/worktree",
        "existing-branch",
      ]);
    });

    test("should create a new branch and worktree for a non-existent branch", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve(""));

      await manager.addWorktree("/path/to/worktree", "new-branch", {
        createBranch: true,
      });

      expect(mockGit.raw).toHaveBeenCalledWith([
        "worktree",
        "add",
        "-b",
        "new-branch",
        "/path/to/worktree",
      ]);
    });

    test("should create a new branch with tracking for a remote branch", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve(""));

      await manager.addWorktree("/path/to/worktree", "new-branch", {
        createBranch: true,
        track: "origin/feature-branch",
      });

      expect(mockGit.raw).toHaveBeenCalledWith([
        "worktree",
        "add",
        "-b",
        "new-branch",
        "--track",
        "origin/feature-branch",
        "/path/to/worktree",
        "origin/feature-branch",
      ]);
    });

    test("should throw an error if adding worktree fails", async () => {
      mockGit.raw.mockImplementation(() => Promise.reject(new Error("fatal: invalid reference")));

      await expect(
        manager.addWorktree("/path/to/worktree", "invalid-branch", {
          createBranch: false,
        })
      ).rejects.toThrow("Failed to add worktree");
    });
  });

  describe("getDefaultBranch", () => {
    test("should return the default branch from remote HEAD", async () => {
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "symbolic-ref") {
          return Promise.resolve("refs/remotes/origin/main\n");
        }
        return Promise.resolve("");
      });

      const result = await manager.getDefaultBranch();

      expect(result).toBe("main");
      expect(mockGit.raw).toHaveBeenCalledWith([
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
      ]);
    });

    test("should fallback to main if symbolic-ref fails", async () => {
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "symbolic-ref") {
          return Promise.reject(new Error("fatal: not a symbolic ref"));
        }
        if (args[0] === "rev-parse" && args[2] === "refs/heads/main") {
          return Promise.resolve("abc123");
        }
        return Promise.reject(new Error("branch not found"));
      });

      const result = await manager.getDefaultBranch();

      expect(result).toBe("main");
    });

    test("should fallback to master if main does not exist", async () => {
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "symbolic-ref") {
          return Promise.reject(new Error("fatal: not a symbolic ref"));
        }
        if (args[0] === "rev-parse" && args[2] === "refs/heads/main") {
          return Promise.reject(new Error("branch not found"));
        }
        if (args[0] === "rev-parse" && args[2] === "refs/heads/master") {
          return Promise.resolve("abc123");
        }
        return Promise.reject(new Error("branch not found"));
      });

      const result = await manager.getDefaultBranch();

      expect(result).toBe("master");
    });

    test("should throw error if no default branch can be determined", async () => {
      mockGit.raw.mockImplementation(() => Promise.reject(new Error("not found")));

      await expect(manager.getDefaultBranch()).rejects.toThrow(
        "Could not determine default branch"
      );
    });
  });

  describe("syncBranch", () => {
    test("should fetch and update the specified branch from origin", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve(""));

      await manager.syncBranch("main");

      expect(mockGit.raw).toHaveBeenCalledWith([
        "fetch",
        "origin",
        "main:main",
      ]);
    });

    test("should sync feature branches", async () => {
      mockGit.raw.mockImplementation(() => Promise.resolve(""));

      await manager.syncBranch("develop");

      expect(mockGit.raw).toHaveBeenCalledWith([
        "fetch",
        "origin",
        "develop:develop",
      ]);
    });

    test("should throw an error if sync fails", async () => {
      mockGit.raw.mockImplementation(() =>
        Promise.reject(new Error("fatal: couldn't find remote ref"))
      );

      await expect(manager.syncBranch("non-existent-branch")).rejects.toThrow(
        "Failed to sync branch 'non-existent-branch'"
      );
    });
  });

  describe("findWorktreeByName", () => {
    test("should find worktree by exact branch name", async () => {
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "config") {
          return Promise.resolve("false");
        }
        if (args[0] === "worktree" && args[1] === "list") {
          return Promise.resolve(
            "worktree /home/user/repo/main\n" +
            "HEAD abc123\n" +
            "branch refs/heads/main\n" +
            "\n" +
            "worktree /home/user/repo/feature-branch\n" +
            "HEAD def456\n" +
            "branch refs/heads/feature-branch\n"
          );
        }
        return Promise.resolve("");
      });
      mockGit.status.mockImplementation(() =>
        Promise.resolve({ isClean: () => true })
      );

      const result = await manager.findWorktreeByName("feature-branch");

      expect(result).toBeDefined();
      expect(result?.branch).toBe("feature-branch");
      expect(result?.path).toBe("/home/user/repo/feature-branch");
    });

    test("should find worktree by directory name", async () => {
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "config") {
          return Promise.resolve("false");
        }
        if (args[0] === "worktree" && args[1] === "list") {
          return Promise.resolve(
            "worktree /home/user/repo/my-worktree\n" +
            "HEAD abc123\n" +
            "branch refs/heads/feature/some-feature\n"
          );
        }
        return Promise.resolve("");
      });
      mockGit.status.mockImplementation(() =>
        Promise.resolve({ isClean: () => true })
      );

      const result = await manager.findWorktreeByName("my-worktree");

      expect(result).toBeDefined();
      expect(result?.branch).toBe("feature/some-feature");
      expect(result?.path).toBe("/home/user/repo/my-worktree");
    });

    test("should find worktree by partial branch name suffix", async () => {
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "config") {
          return Promise.resolve("false");
        }
        if (args[0] === "worktree" && args[1] === "list") {
          return Promise.resolve(
            "worktree /home/user/repo/feature/my-feature\n" +
            "HEAD abc123\n" +
            "branch refs/heads/feature/my-feature\n"
          );
        }
        return Promise.resolve("");
      });
      mockGit.status.mockImplementation(() =>
        Promise.resolve({ isClean: () => true })
      );

      const result = await manager.findWorktreeByName("my-feature");

      expect(result).toBeDefined();
      expect(result?.branch).toBe("feature/my-feature");
    });

    test("should return undefined when worktree not found", async () => {
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "config") {
          return Promise.resolve("false");
        }
        if (args[0] === "worktree" && args[1] === "list") {
          return Promise.resolve(
            "worktree /home/user/repo/main\n" +
            "HEAD abc123\n" +
            "branch refs/heads/main\n"
          );
        }
        return Promise.resolve("");
      });
      mockGit.status.mockImplementation(() =>
        Promise.resolve({ isClean: () => true })
      );

      const result = await manager.findWorktreeByName("non-existent");

      expect(result).toBeUndefined();
    });

    test("should prefer exact branch name match over directory name", async () => {
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === "config") {
          return Promise.resolve("false");
        }
        if (args[0] === "worktree" && args[1] === "list") {
          return Promise.resolve(
            "worktree /home/user/repo/feature-branch\n" +
            "HEAD abc123\n" +
            "branch refs/heads/other-branch\n" +
            "\n" +
            "worktree /home/user/repo/other-dir\n" +
            "HEAD def456\n" +
            "branch refs/heads/feature-branch\n"
          );
        }
        return Promise.resolve("");
      });
      mockGit.status.mockImplementation(() =>
        Promise.resolve({ isClean: () => true })
      );

      const result = await manager.findWorktreeByName("feature-branch");

      expect(result).toBeDefined();
      expect(result?.branch).toBe("feature-branch");
      expect(result?.path).toBe("/home/user/repo/other-dir");
    });
  });
});
