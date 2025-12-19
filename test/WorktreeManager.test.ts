import { WorktreeManager } from "../src/git/WorktreeManager";
import { SimpleGit } from "simple-git";

// Mock simple-git
jest.mock("simple-git");

describe("WorktreeManager", () => {
  let manager: WorktreeManager;
  let mockGit: jest.Mocked<SimpleGit>;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Create a mock git instance
    mockGit = {
      raw: jest.fn(),
      status: jest.fn(),
      clone: jest.fn(),
      addConfig: jest.fn(),
    } as any;

    // Mock simpleGit to return our mock git instance
    const simpleGit = require("simple-git");
    simpleGit.simpleGit = jest.fn(() => mockGit);

    manager = new WorktreeManager();
  });

  describe("branchExists", () => {
    test("should return true when a branch exists", async () => {
      // Mock successful rev-parse response
      mockGit.raw.mockResolvedValue("abc123def456");

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
      mockGit.raw.mockRejectedValue(new Error("fatal: Needed a single revision"));

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
      mockGit.raw.mockResolvedValue("");

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
      mockGit.raw.mockResolvedValue("");

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
      mockGit.raw.mockResolvedValue("");

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
      mockGit.raw.mockRejectedValue(new Error("fatal: invalid reference"));

      await expect(
        manager.addWorktree("/path/to/worktree", "invalid-branch", {
          createBranch: false,
        })
      ).rejects.toThrow("Failed to add worktree");
    });
  });
});
