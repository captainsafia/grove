import { describe, test, expect } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  copyConfiguredEntries,
  readGrovercCopyConfig,
} from "../../src/commands/add";

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("readGrovercCopyConfig", () => {
  test("returns null when .groverc does not exist", async () => {
    const projectRoot = await createTempDir("grove-groverc-none-");
    const config = await readGrovercCopyConfig(projectRoot);
    expect(config).toBeNull();
  });

  test("parses valid copy config", async () => {
    const projectRoot = await createTempDir("grove-groverc-valid-");
    await fs.writeFile(
      path.join(projectRoot, ".groverc"),
      JSON.stringify({
        copy: {
          from: "main",
          include: ["apps/*/.env", ".env"],
          exclude: ["apps/web/.env.local"],
        },
      }),
    );

    const config = await readGrovercCopyConfig(projectRoot);

    expect(config).not.toBeNull();
    expect(config?.from).toBe("main");
    expect(config?.include).toEqual(["apps/*/.env", ".env"]);
    expect(config?.exclude).toEqual(["apps/web/.env.local"]);
  });

  test("throws for invalid include config", async () => {
    const projectRoot = await createTempDir("grove-groverc-invalid-");
    await fs.writeFile(
      path.join(projectRoot, ".groverc"),
      JSON.stringify({ copy: { include: [] } }),
    );

    await expect(readGrovercCopyConfig(projectRoot)).rejects.toThrow(
      "Invalid .groverc copy.include",
    );
  });
});

describe("copyConfiguredEntries", () => {
  test("treats bare file names as recursive (e.g. Taskfile.yaml)", async () => {
    const sourceDir = await createTempDir("grove-copy-source-taskfile-");
    const targetDir = await createTempDir("grove-copy-target-taskfile-");

    await fs.mkdir(path.join(sourceDir, "apps", "web"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "Taskfile.yaml"), "version: '3'\n");
    await fs.writeFile(path.join(sourceDir, "apps", "web", "Taskfile.yaml"), "version: '3'\n");

    const copiedCount = await copyConfiguredEntries(
      {
        include: ["Taskfile.yaml"],
      },
      sourceDir,
      targetDir,
    );

    expect(copiedCount).toBe(2);

    const rootTaskfile = await fs.readFile(path.join(targetDir, "Taskfile.yaml"), "utf8");
    expect(rootTaskfile).toContain("version:");

    const nestedTaskfile = await fs.readFile(path.join(targetDir, "apps", "web", "Taskfile.yaml"), "utf8");
    expect(nestedTaskfile).toContain("version:");
  });

  test("treats '.env' include as recursive across monorepo directories", async () => {
    const sourceDir = await createTempDir("grove-copy-source-env-");
    const targetDir = await createTempDir("grove-copy-target-env-");

    await fs.mkdir(path.join(sourceDir, "apps", "web"), { recursive: true });
    await fs.mkdir(path.join(sourceDir, "apps", "api"), { recursive: true });

    await fs.writeFile(path.join(sourceDir, ".env"), "ROOT=1\n");
    await fs.writeFile(path.join(sourceDir, "apps", "web", ".env"), "WEB=1\n");
    await fs.writeFile(path.join(sourceDir, "apps", "api", ".env"), "API=1\n");

    const copiedCount = await copyConfiguredEntries(
      {
        include: [".env"],
      },
      sourceDir,
      targetDir,
    );

    expect(copiedCount).toBe(3);

    const rootEnv = await fs.readFile(path.join(targetDir, ".env"), "utf8");
    expect(rootEnv).toContain("ROOT=1");

    const webEnv = await fs.readFile(path.join(targetDir, "apps", "web", ".env"), "utf8");
    expect(webEnv).toContain("WEB=1");

    const apiEnv = await fs.readFile(path.join(targetDir, "apps", "api", ".env"), "utf8");
    expect(apiEnv).toContain("API=1");
  });

  test("copies explicit directory includes without glob syntax", async () => {
    const sourceDir = await createTempDir("grove-copy-source-dir-");
    const targetDir = await createTempDir("grove-copy-target-dir-");

    await fs.mkdir(path.join(sourceDir, ".vscode"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, ".vscode", "settings.json"), "{\"a\":1}\n");

    const copiedCount = await copyConfiguredEntries(
      {
        include: [".vscode"],
      },
      sourceDir,
      targetDir,
    );

    expect(copiedCount).toBe(1);

    const content = await fs.readFile(path.join(targetDir, ".vscode", "settings.json"), "utf8");
    expect(content).toContain("\"a\":1");
  });

  test("copies include matches and respects exclude + .git skip", async () => {
    const sourceDir = await createTempDir("grove-copy-source-");
    const targetDir = await createTempDir("grove-copy-target-");

    await fs.mkdir(path.join(sourceDir, "apps", "web"), { recursive: true });
    await fs.mkdir(path.join(sourceDir, "apps", "api"), { recursive: true });
    await fs.mkdir(path.join(sourceDir, ".git"), { recursive: true });

    await fs.writeFile(path.join(sourceDir, ".env"), "ROOT=1\n");
    await fs.writeFile(path.join(sourceDir, "apps", "web", ".env"), "WEB=1\n");
    await fs.writeFile(path.join(sourceDir, "apps", "web", ".env.local"), "WEB_LOCAL=1\n");
    await fs.writeFile(path.join(sourceDir, "apps", "api", ".env"), "API=1\n");
    await fs.writeFile(path.join(sourceDir, ".git", "config"), "[core]\n");

    const copiedCount = await copyConfiguredEntries(
      {
        include: [".env", "apps/*/.env", ".git/**"],
        exclude: ["apps/web/.env"],
      },
      sourceDir,
      targetDir,
    );

    expect(copiedCount).toBe(2);

    const rootEnv = await fs.readFile(path.join(targetDir, ".env"), "utf8");
    expect(rootEnv).toContain("ROOT=1");

    const apiEnv = await fs.readFile(path.join(targetDir, "apps", "api", ".env"), "utf8");
    expect(apiEnv).toContain("API=1");

    await expect(fs.access(path.join(targetDir, "apps", "web", ".env"))).rejects.toThrow();
    await expect(fs.access(path.join(targetDir, ".git"))).rejects.toThrow();
  });

  test("returns zero when source and target are the same", async () => {
    const dir = await createTempDir("grove-copy-same-");
    await fs.writeFile(path.join(dir, ".env"), "A=1\n");

    const copiedCount = await copyConfiguredEntries(
      { include: [".env"] },
      dir,
      dir,
    );

    expect(copiedCount).toBe(0);
  });
});
