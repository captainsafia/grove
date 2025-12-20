import { describe, test, expect, beforeEach, mock, Mock } from "bun:test";
import { WorktreeManager } from "../src/git/WorktreeManager";
import type { SimpleGit } from "simple-git";

// Mock simple-git
mock.module("simple-git", () => ({
  simpleGit: () => mockGit,
}));

let mockGit: {
  raw: Mock<(...args: any[]) => Promise<string>>;
  status: Mock<(...args: any[]) => Promise<any>>;
  clone: Mock<(...args: any[]) => Promise<any>>;
  addConfig: Mock<(...args: any[]) => Promise<any>>;
};

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
});
