import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { WorktreeManager } from "../../src/git/WorktreeManager";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { $ } from "bun";

/**
 * Integration tests that run against real git repositories in temp directories.
 * These tests catch issues that mocked tests might miss.
 * 
 * Note: We use Bun's shell ($) instead of simple-git to avoid module mock pollution
 * from other test files.
 */

// Helper to run git commands
async function runGit(cwd: string, ...args: string[]): Promise<string> {
  const result = await $`git -C ${cwd} ${args}`.quiet();
  return result.text().trim();
}

describe("WorktreeManager Integration Tests", () => {
  let tempDir: string;
  let repoPath: string;
  let manager: WorktreeManager;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "grove-test-"));
    repoPath = path.join(tempDir, "test-repo");

    // Initialize a new git repository using shell commands
    fs.mkdirSync(repoPath);
    await runGit(repoPath, "init");

    // Configure git user for commits
    await runGit(repoPath, "config", "user.email", "test@example.com");
    await runGit(repoPath, "config", "user.name", "Test User");

    // Create initial commit
    const testFile = path.join(repoPath, "README.md");
    fs.writeFileSync(testFile, "# Test Repository\n");
    await runGit(repoPath, "add", "README.md");
    await runGit(repoPath, "commit", "-m", "Initial commit");

    // Create the WorktreeManager pointing to our test repo
    manager = new WorktreeManager(repoPath);
    await manager.initialize();
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Warning: Could not clean up temp directory: ${error}`);
    }
  });

  describe("branchExists", () => {
    test("should return true for existing branch", async () => {
      // Get the default branch name
      const branchOutput = await runGit(repoPath, "branch", "--show-current");
      const defaultBranch = branchOutput || "master";

      const result = await manager.branchExists(defaultBranch);
      expect(result).toBe(true);
    });

    test("should return false for non-existent branch", async () => {
      const result = await manager.branchExists("non-existent-branch");
      expect(result).toBe(false);
    });

    test("should detect newly created branch", async () => {
      // Create a new branch
      await runGit(repoPath, "checkout", "-b", "feature/new-branch");

      const result = await manager.branchExists("feature/new-branch");
      expect(result).toBe(true);
    });

    test("should handle branch names with slashes", async () => {
      await runGit(repoPath, "checkout", "-b", "feature/nested/branch");

      const result = await manager.branchExists("feature/nested/branch");
      expect(result).toBe(true);
    });
  });

  describe("addWorktree and listWorktrees", () => {
    test("should create a worktree for existing branch", async () => {
      const branchName = "feature-test";
      const worktreePath = path.join(tempDir, branchName);

      // Create the branch first
      await runGit(repoPath, "checkout", "-b", branchName);
      // Switch back to initial branch
      await runGit(repoPath, "checkout", "-").catch(() => {});

      await manager.addWorktree(worktreePath, branchName, {
        createBranch: false,
      });

      // Verify worktree was created
      expect(fs.existsSync(worktreePath)).toBe(true);

      // Verify it appears in the list
      const worktrees = await manager.listWorktrees();
      const found = worktrees.find((w) => w.path === worktreePath);
      expect(found).toBeDefined();
      expect(found?.branch).toBe(branchName);
    });

    test("should create a new branch with worktree", async () => {
      const branchName = "new-feature";
      const worktreePath = path.join(tempDir, branchName);

      await manager.addWorktree(worktreePath, branchName, {
        createBranch: true,
      });

      // Verify worktree was created
      expect(fs.existsSync(worktreePath)).toBe(true);

      // Verify branch exists
      const branchExists = await manager.branchExists(branchName);
      expect(branchExists).toBe(true);
    });

    test("should list multiple worktrees", async () => {
      // Create two worktrees
      const worktree1 = path.join(tempDir, "worktree-1");
      const worktree2 = path.join(tempDir, "worktree-2");

      await manager.addWorktree(worktree1, "branch-1", { createBranch: true });
      await manager.addWorktree(worktree2, "branch-2", { createBranch: true });

      const worktrees = await manager.listWorktrees();

      // Should have main repo + 2 worktrees
      expect(worktrees.length).toBeGreaterThanOrEqual(3);

      const branches = worktrees.map((w) => w.branch);
      expect(branches).toContain("branch-1");
      expect(branches).toContain("branch-2");
    });
  });

  describe("removeWorktree", () => {
    test("should remove an existing worktree", async () => {
      const branchName = "to-remove";
      const worktreePath = path.join(tempDir, branchName);

      // Create worktree
      await manager.addWorktree(worktreePath, branchName, {
        createBranch: true,
      });
      expect(fs.existsSync(worktreePath)).toBe(true);

      // Remove worktree
      await manager.removeWorktree(worktreePath);

      // Verify it's gone
      const worktrees = await manager.listWorktrees();
      const found = worktrees.find((w) => w.path === worktreePath);
      expect(found).toBeUndefined();
    });

    test("should force remove a dirty worktree", async () => {
      const branchName = "dirty-branch";
      const worktreePath = path.join(tempDir, branchName);

      // Create worktree
      await manager.addWorktree(worktreePath, branchName, {
        createBranch: true,
      });

      // Make it dirty by adding an untracked file
      fs.writeFileSync(path.join(worktreePath, "untracked.txt"), "content");

      // Force remove should work
      await manager.removeWorktree(worktreePath, true);

      const worktrees = await manager.listWorktrees();
      const found = worktrees.find((w) => w.path === worktreePath);
      expect(found).toBeUndefined();
    });
  });

  describe("getDefaultBranch", () => {
    test("should detect main as default branch", async () => {
      // Create a main branch if it doesn't exist
      const branchList = await runGit(repoPath, "branch", "--list");
      if (!branchList.includes("main")) {
        await runGit(repoPath, "checkout", "-b", "main").catch(() => {});
      }

      const result = await manager.getDefaultBranch();
      expect(["main", "master"]).toContain(result);
    });
  });

  describe("isBranchMerged", () => {
    test("should detect a merged branch", async () => {
      const baseBranch = await runGit(repoPath, "branch", "--show-current") || "master";

      // Create and checkout a feature branch
      await runGit(repoPath, "checkout", "-b", "feature-to-merge");

      // Make a commit on the feature branch
      const testFile = path.join(repoPath, "feature.txt");
      fs.writeFileSync(testFile, "feature content");
      await runGit(repoPath, "add", "feature.txt");
      await runGit(repoPath, "commit", "-m", "Feature commit");

      // Go back to base branch and merge
      await runGit(repoPath, "checkout", baseBranch);
      await runGit(repoPath, "merge", "feature-to-merge");

      // Check if merged
      const result = await manager.isBranchMerged("feature-to-merge", baseBranch);
      expect(result).toBe(true);
    });

    test("should detect an unmerged branch", async () => {
      const baseBranch = await runGit(repoPath, "branch", "--show-current") || "master";

      // Create a feature branch with changes
      await runGit(repoPath, "checkout", "-b", "unmerged-feature");
      const testFile = path.join(repoPath, "unmerged.txt");
      fs.writeFileSync(testFile, "unmerged content");
      await runGit(repoPath, "add", "unmerged.txt");
      await runGit(repoPath, "commit", "-m", "Unmerged commit");

      // Go back to base branch (don't merge)
      await runGit(repoPath, "checkout", baseBranch);

      // Check if merged
      const result = await manager.isBranchMerged("unmerged-feature", baseBranch);
      expect(result).toBe(false);
    });
  });

  describe("Worktree dirty state detection", () => {
    test("should detect clean worktree", async () => {
      const branchName = "clean-branch";
      const worktreePath = path.join(tempDir, branchName);

      await manager.addWorktree(worktreePath, branchName, {
        createBranch: true,
      });

      const worktrees = await manager.listWorktrees();
      const worktree = worktrees.find((w) => w.path === worktreePath);

      expect(worktree?.isDirty).toBe(false);
    });

    test("should detect dirty worktree with modified file", async () => {
      const branchName = "dirty-modified";
      const worktreePath = path.join(tempDir, branchName);

      await manager.addWorktree(worktreePath, branchName, {
        createBranch: true,
      });

      // Modify a tracked file
      fs.writeFileSync(path.join(worktreePath, "README.md"), "Modified content");

      const worktrees = await manager.listWorktrees();
      const worktree = worktrees.find((w) => w.path === worktreePath);

      expect(worktree?.isDirty).toBe(true);
    });

    test("should detect dirty worktree with untracked file", async () => {
      const branchName = "dirty-untracked";
      const worktreePath = path.join(tempDir, branchName);

      await manager.addWorktree(worktreePath, branchName, {
        createBranch: true,
      });

      // Add an untracked file
      fs.writeFileSync(path.join(worktreePath, "new-file.txt"), "New content");

      const worktrees = await manager.listWorktrees();
      const worktree = worktrees.find((w) => w.path === worktreePath);

      expect(worktree?.isDirty).toBe(true);
    });
  });

  describe("Special branch name handling", () => {
    test("should handle branch with slash in name", async () => {
      const branchName = "feature/my-feature";
      const worktreePath = path.join(tempDir, "my-feature");

      await manager.addWorktree(worktreePath, branchName, {
        createBranch: true,
      });

      const worktrees = await manager.listWorktrees();
      const worktree = worktrees.find((w) => w.path === worktreePath);

      expect(worktree?.branch).toBe(branchName);
    });

    test("should handle branch with dots in name", async () => {
      const branchName = "release/v1.2.3";
      const worktreePath = path.join(tempDir, "release-v1.2.3");

      await manager.addWorktree(worktreePath, branchName, {
        createBranch: true,
      });

      const exists = await manager.branchExists(branchName);
      expect(exists).toBe(true);
    });

    test("should handle branch with numbers", async () => {
      const branchName = "issue-12345";
      const worktreePath = path.join(tempDir, branchName);

      await manager.addWorktree(worktreePath, branchName, {
        createBranch: true,
      });

      const exists = await manager.branchExists(branchName);
      expect(exists).toBe(true);
    });
  });

  describe("syncBranch", () => {
    // Note: syncBranch requires a remote, which is complex to set up in tests.
    // These tests verify error handling for missing remote.
    test("should throw error when syncing branch without remote", async () => {
      await expect(manager.syncBranch("main")).rejects.toThrow(
        "Failed to sync branch"
      );
    });
  });
});

describe("Grove Anywhere - Discovery Integration Tests", () => {
  let tempDir: string;
  let bareRepoPath: string;
  let projectRoot: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "grove-anywhere-test-"));
    projectRoot = path.join(tempDir, "myproject");
    bareRepoPath = path.join(projectRoot, "myproject.git");

    // Create the grove structure: projectRoot/repo.git
    fs.mkdirSync(projectRoot, { recursive: true });

    // Create a bare repository
    await $`git init --bare ${bareRepoPath}`.quiet();

    // We need to create an initial commit in the bare repo for worktrees to work
    // Create a temp normal repo, make a commit, push to bare
    const tempNormalRepo = path.join(tempDir, "temp-init");
    fs.mkdirSync(tempNormalRepo);
    await $`git -C ${tempNormalRepo} init`.quiet();
    await $`git -C ${tempNormalRepo} config user.email test@example.com`.quiet();
    await $`git -C ${tempNormalRepo} config user.name "Test User"`.quiet();
    fs.writeFileSync(path.join(tempNormalRepo, "README.md"), "# Test\n");
    await $`git -C ${tempNormalRepo} add README.md`.quiet();
    await $`git -C ${tempNormalRepo} commit -m "Initial commit"`.quiet();
    await $`git -C ${tempNormalRepo} remote add origin ${bareRepoPath}`.quiet();
    await $`git -C ${tempNormalRepo} push origin HEAD:main`.quiet();
    fs.rmSync(tempNormalRepo, { recursive: true, force: true });

    // Configure fetch refspec on bare repo
    await $`git -C ${bareRepoPath} config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"`.quiet();
  });

  afterEach(() => {
    try {
      // Clear GROVE_REPO env var between tests
      delete process.env.GROVE_REPO;
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Warning: Could not clean up temp directory: ${error}`);
    }
  });

  test("should discover bare clone from worktree root", async () => {
    // Create a worktree
    const worktreePath = path.join(projectRoot, "main");
    await $`git -C ${bareRepoPath} worktree add ${worktreePath} main`.quiet();

    // Clear any cached GROVE_REPO
    delete process.env.GROVE_REPO;

    // Change to worktree and discover
    const originalCwd = process.cwd();
    try {
      process.chdir(worktreePath);
      const manager = await WorktreeManager.discover({ cache: false });
      expect(manager.getRepoPath()).toBe(bareRepoPath);
      expect(manager.getProjectRoot()).toBe(projectRoot);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("should discover bare clone from nested directory within worktree", async () => {
    // Create a worktree
    const worktreePath = path.join(projectRoot, "main");
    await $`git -C ${bareRepoPath} worktree add ${worktreePath} main`.quiet();

    // Create nested directories
    const nestedPath = path.join(worktreePath, "src", "components");
    fs.mkdirSync(nestedPath, { recursive: true });

    // Clear any cached GROVE_REPO
    delete process.env.GROVE_REPO;

    // Change to nested directory and discover
    const originalCwd = process.cwd();
    try {
      process.chdir(nestedPath);
      const manager = await WorktreeManager.discover({ cache: false });
      expect(manager.getRepoPath()).toBe(bareRepoPath);
      expect(manager.getProjectRoot()).toBe(projectRoot);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("should discover bare clone from bare repo directory itself", async () => {
    // Clear any cached GROVE_REPO
    delete process.env.GROVE_REPO;

    // Change to bare repo and discover
    const originalCwd = process.cwd();
    try {
      process.chdir(bareRepoPath);
      const manager = await WorktreeManager.discover({ cache: false });
      expect(manager.getRepoPath()).toBe(bareRepoPath);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("should cache discovered path in GROVE_REPO when cache=true", async () => {
    // Create a worktree
    const worktreePath = path.join(projectRoot, "main");
    await $`git -C ${bareRepoPath} worktree add ${worktreePath} main`.quiet();

    // Clear any cached GROVE_REPO
    delete process.env.GROVE_REPO;

    // Change to worktree and discover with caching
    const originalCwd = process.cwd();
    try {
      process.chdir(worktreePath);
      await WorktreeManager.discover({ cache: true });
      expect(process.env.GROVE_REPO).toBe(bareRepoPath);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("should not cache discovered path when cache=false", async () => {
    // Create a worktree
    const worktreePath = path.join(projectRoot, "main");
    await $`git -C ${bareRepoPath} worktree add ${worktreePath} main`.quiet();

    // Clear any cached GROVE_REPO
    delete process.env.GROVE_REPO;

    // Change to worktree and discover without caching
    const originalCwd = process.cwd();
    try {
      process.chdir(worktreePath);
      await WorktreeManager.discover({ cache: false });
      expect(process.env.GROVE_REPO).toBeUndefined();
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("should use GROVE_REPO env var if set and valid", async () => {
    // Set GROVE_REPO to the bare repo path
    process.env.GROVE_REPO = bareRepoPath;

    // Discovery should use the env var even from a different directory
    const originalCwd = process.cwd();
    try {
      process.chdir(tempDir); // Different directory
      const manager = await WorktreeManager.discover({ cache: false });
      expect(manager.getRepoPath()).toBe(bareRepoPath);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("should ignore invalid GROVE_REPO and rediscover", async () => {
    // Create a worktree
    const worktreePath = path.join(projectRoot, "main");
    await $`git -C ${bareRepoPath} worktree add ${worktreePath} main`.quiet();

    // Set GROVE_REPO to an invalid path
    process.env.GROVE_REPO = "/nonexistent/path";

    // Change to worktree - should ignore invalid env and discover correctly
    const originalCwd = process.cwd();
    try {
      process.chdir(worktreePath);
      const manager = await WorktreeManager.discover({ cache: false });
      expect(manager.getRepoPath()).toBe(bareRepoPath);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("Bare Repository Integration Tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "grove-bare-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Warning: Could not clean up temp directory: ${error}`);
    }
  });

  test("should initialize in a bare repository", async () => {
    const barePath = path.join(tempDir, "bare-repo.git");

    // Create a bare repository using shell commands
    fs.mkdirSync(barePath);
    await $`git -C ${barePath} init --bare`.quiet();

    // Should be able to initialize WorktreeManager with bare repo
    const manager = new WorktreeManager(barePath);
    await manager.initialize();
    // If we got here without throwing, the test passes
    expect(true).toBe(true);
  });
});
