import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let testDir: string;
let settingsDir: string;
const cliPath = join(import.meta.dir, "../../src/cli.ts");

beforeEach(() => {
  testDir = join(tmpdir(), `cc-guard-test-init-${Date.now()}`);
  settingsDir = join(testDir, "claude-home");
  mkdirSync(join(settingsDir), { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

async function runInit(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", cliPath, "init"], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CC_GUARD_DIR: join(testDir, "cc-guard"),
      HOME: testDir,
    },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("init command — multi-tool registration", () => {
  it("registers 7 PreToolUse entries on fresh install", async () => {
    // Create empty settings.json
    const settingsPath = join(testDir, ".claude", "settings.json");
    mkdirSync(join(testDir, ".claude"), { recursive: true });
    writeFileSync(settingsPath, "{}");

    await runInit();

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const preToolUse = settings.hooks?.PreToolUse ?? [];
    const ccGuardEntries = preToolUse.filter((e: any) =>
      e.hooks?.some((h: any) => h.command?.includes("cc-guard")),
    );
    expect(ccGuardEntries.length).toBe(7);

    const matchers = ccGuardEntries.map((e: any) => e.matcher).sort();
    expect(matchers).toEqual(["Bash", "Edit", "Glob", "Grep", "Read", "Skill", "Write"]);
  });

  it("upgrades Bash-only install to 7 tools", async () => {
    const settingsPath = join(testDir, ".claude", "settings.json");
    mkdirSync(join(testDir, ".claude"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "cc-guard check" }],
            },
          ],
        },
      }),
    );

    await runInit();

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const preToolUse = settings.hooks.PreToolUse;
    const ccGuardEntries = preToolUse.filter((e: any) =>
      e.hooks?.some((h: any) => h.command?.includes("cc-guard")),
    );
    expect(ccGuardEntries.length).toBe(7);
  });

  it("does not duplicate entries on repeated init", async () => {
    const settingsPath = join(testDir, ".claude", "settings.json");
    mkdirSync(join(testDir, ".claude"), { recursive: true });
    writeFileSync(settingsPath, "{}");

    await runInit();
    await runInit(); // Run twice

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const preToolUse = settings.hooks.PreToolUse;
    const ccGuardEntries = preToolUse.filter((e: any) =>
      e.hooks?.some((h: any) => h.command?.includes("cc-guard")),
    );
    expect(ccGuardEntries.length).toBe(7);
  });

  it("preserves SessionEnd hook", async () => {
    const settingsPath = join(testDir, ".claude", "settings.json");
    mkdirSync(join(testDir, ".claude"), { recursive: true });
    writeFileSync(settingsPath, "{}");

    await runInit();

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const sessionEnd = settings.hooks?.SessionEnd ?? [];
    const learnHook = sessionEnd.find((e: any) =>
      e.hooks?.some((h: any) => h.command?.includes("cc-guard learn")),
    );
    expect(learnHook).toBeDefined();
  });

  it("creates cc-guard directory structure", async () => {
    const settingsPath = join(testDir, ".claude", "settings.json");
    mkdirSync(join(testDir, ".claude"), { recursive: true });
    writeFileSync(settingsPath, "{}");

    await runInit();

    const ccGuardDir = join(testDir, "cc-guard");
    expect(existsSync(ccGuardDir)).toBe(true);
    expect(existsSync(join(ccGuardDir, "sessions"))).toBe(true);
    expect(existsSync(join(ccGuardDir, "projects"))).toBe(true);
  });

  it("creates config.yaml with all-tool scope", async () => {
    const settingsPath = join(testDir, ".claude", "settings.json");
    mkdirSync(join(testDir, ".claude"), { recursive: true });
    writeFileSync(settingsPath, "{}");

    await runInit();

    const configPath = join(testDir, "cc-guard", "config.yaml");
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("Bash,Read,Write,Edit,Glob,Grep,Skill");
  });

  it("handles missing settings.json gracefully", async () => {
    // Don't create .claude directory — init should create it
    mkdirSync(join(testDir, ".claude"), { recursive: true });

    const { exitCode } = await runInit();
    expect(exitCode).toBe(0);
  });
});
