import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringify } from "yaml";

let testDir: string;
const cliPath = join(import.meta.dir, "../../src/cli.ts");

beforeEach(() => {
  testDir = join(tmpdir(), `cc-guard-test-allow-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  // Write rules.yaml with deny rules
  const rules = {
    version: 1,
    deny: [
      { pattern: "git reset --hard", reason: "Hard reset" },
      { pattern: "^sudo ", reason: "Elevated privileges" },
      { pattern: "\\.env$", reason: "Env file", tools: ["Read", "Write", "Edit", "Glob", "Grep"] },
    ],
    allow: [],
  };
  writeFileSync(join(testDir, "rules.yaml"), stringify(rules));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function makeEnv() {
  return { ...process.env, CC_GUARD_DIR: testDir };
}

async function runCheck(toolName: string, toolInput: Record<string, unknown>): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const input = JSON.stringify({
    tool_name: toolName,
    tool_input: toolInput,
    session_id: "test",
    cwd: "/",
    hook_event_name: "PreToolUse",
  });
  const proc = Bun.spawn(["bun", "run", cliPath, "check"], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: new Blob([input]),
    env: makeEnv(),
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stdout, stderr };
}

async function runCmd(...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", cliPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: makeEnv(),
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stdout, stderr };
}

describe("interactive deny — allow-once flow", () => {
  it("deny message includes allow hints", async () => {
    const { exitCode, stderr } = await runCheck("Bash", { command: "git reset --hard HEAD" });
    expect(exitCode).toBe(2);
    expect(stderr).toContain("BLOCKED");
    expect(stderr).toContain('allow-once "git reset --hard"');
    expect(stderr).toContain('allow-session "git reset --hard"');
  });

  it("allow-once → check allows once, then re-denies", async () => {
    // First check — denied
    const r1 = await runCheck("Bash", { command: "git reset --hard HEAD" });
    expect(r1.exitCode).toBe(2);

    // Add allow-once
    const add = await runCmd("allow-once", "git reset --hard");
    expect(add.exitCode).toBe(0);
    expect(add.stdout).toContain("Temporary allow added");

    // Second check — allowed (temp-allow consumed)
    const r2 = await runCheck("Bash", { command: "git reset --hard HEAD" });
    expect(r2.exitCode).toBe(0);

    // Third check — denied again (consumed)
    const r3 = await runCheck("Bash", { command: "git reset --hard HEAD" });
    expect(r3.exitCode).toBe(2);
  });

  it("allow-session → check allows multiple times", async () => {
    await runCmd("allow-session", "git reset --hard");

    const r1 = await runCheck("Bash", { command: "git reset --hard HEAD" });
    expect(r1.exitCode).toBe(0);

    const r2 = await runCheck("Bash", { command: "git reset --hard HEAD~3" });
    expect(r2.exitCode).toBe(0);

    const r3 = await runCheck("Bash", { command: "git reset --hard HEAD~5" });
    expect(r3.exitCode).toBe(0);
  });
});

describe("interactive deny — management commands", () => {
  it("allows lists active entries", async () => {
    await runCmd("allow-once", "git reset --hard");
    await runCmd("allow-session", "^sudo ");

    const { exitCode, stdout } = await runCmd("allows");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("git reset --hard");
    expect(stdout).toContain("^sudo ");
    expect(stdout).toContain("once");
    expect(stdout).toContain("session");
  });

  it("revoke removes entry, subsequent check denies", async () => {
    await runCmd("allow-session", "git reset --hard");
    await runCmd("revoke", "git reset --hard");

    const { exitCode } = await runCheck("Bash", { command: "git reset --hard HEAD" });
    expect(exitCode).toBe(2);
  });

  it("allow-clear removes all", async () => {
    await runCmd("allow-once", "git reset --hard");
    await runCmd("allow-session", "^sudo ");

    const { stdout } = await runCmd("allow-clear");
    expect(stdout).toContain("Cleared 2");

    const { stdout: listOut } = await runCmd("allows");
    expect(listOut).toContain("No active");
  });
});

describe("interactive deny — tool-scoped deny", () => {
  it("Read .env deny message includes pattern", async () => {
    const { exitCode, stderr } = await runCheck("Read", { file_path: "/home/user/.env" });
    expect(exitCode).toBe(2);
    expect(stderr).toContain("BLOCKED");
    expect(stderr).toContain(".env");
  });
});

describe("interactive deny — fail-open", () => {
  it("corrupt temp-allows.json does not crash check", async () => {
    writeFileSync(join(testDir, "temp-allows.json"), "corrupt{{{");
    const { exitCode } = await runCheck("Bash", { command: "echo hello" });
    // Should still work — fail-open
    expect(exitCode).toBe(0);
  });
});
