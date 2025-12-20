import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { $ } from "bun";

/**
 * CLI Command Tests
 * 
 * These tests verify CLI argument parsing, command execution flow,
 * and error handling paths.
 */

// Helper to capture console output
function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args: any[]) => logs.push(args.join(" "));
  console.error = (...args: any[]) => errors.push(args.join(" "));
  console.warn = (...args: any[]) => logs.push(args.join(" "));

  return {
    logs,
    errors,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    },
  };
}

describe("CLI Integration with Real Git Repo", () => {
  let tempDir: string;
  let repoPath: string;

  beforeEach(async () => {
    // Create a temp directory with a git repo using shell commands
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "grove-cli-test-"));
    repoPath = path.join(tempDir, "test-repo");
    fs.mkdirSync(repoPath);

    await $`git -C ${repoPath} init`.quiet();
    await $`git -C ${repoPath} config user.email "test@example.com"`.quiet();
    await $`git -C ${repoPath} config user.name "Test User"`.quiet();

    // Create initial commit
    fs.writeFileSync(path.join(repoPath, "README.md"), "# Test");
    await $`git -C ${repoPath} add README.md`.quiet();
    await $`git -C ${repoPath} commit -m "Initial commit"`.quiet();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test("list command should work in a valid git repo", async () => {
    const originalCwd = process.cwd();
    const capture = captureConsole();

    try {
      process.chdir(repoPath);

      const { createListCommand } = await import("../../src/commands/list");
      const command = createListCommand();

      // Create a program to parse through
      const program = new Command();
      program.addCommand(command);

      // Parse and execute - use 'node' format which expects [node, script, ...args]
      await program.parseAsync(["node", "grove", "list"]);

      // Should not have thrown
      expect(capture.errors.length).toBe(0);
    } finally {
      process.chdir(originalCwd);
      capture.restore();
    }
  });
});
