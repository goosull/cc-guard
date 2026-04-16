import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { HookInput } from "../../src/types";

let testDir: string;
const cliPath = join(import.meta.dir, "../../src/cli.ts");

beforeEach(() => {
  testDir = join(tmpdir(), `cc-guard-test-check-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  writeFileSync(
    join(testDir, "rules.yaml"),
    `version: 1
deny:
  - pattern: "^rm -rf "
    reason: "Recursive force delete"
  - pattern: "git push --force"
    reason: "Force push"
  - pattern: "git reset --hard"
    reason: "Hard reset"
  - pattern: "^sudo "
    reason: "Elevated privileges"
allow:
  - pattern: "^git "
  - pattern: "^echo "
`,
  );
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function makeHookInput(overrides: Partial<HookInput> = {}): HookInput {
  return {
    session_id: "test",
    tool_name: "Bash",
    tool_input: { command: "echo hello" },
    cwd: "/tmp",
    hook_event_name: "PreToolUse",
    ...overrides,
  };
}

async function runCheck(input: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", cliPath, "check"], {
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CC_GUARD_DIR: testDir },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("check command", () => {
  it("denies rm -rf with exit code 2", async () => {
    const input = JSON.stringify(makeHookInput({ tool_input: { command: "rm -rf /" } }));
    const { exitCode, stderr } = await runCheck(input);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("cc-guard");
  });

  it("denies sudo with exit code 2", async () => {
    const input = JSON.stringify(makeHookInput({ tool_input: { command: "sudo apt install" } }));
    const { exitCode } = await runCheck(input);
    expect(exitCode).toBe(2);
  });

  it("allows git status with exit code 0", async () => {
    const input = JSON.stringify(makeHookInput({ tool_input: { command: "git status" } }));
    const { exitCode } = await runCheck(input);
    expect(exitCode).toBe(0);
  });

  it("default-allows unmatched command with exit code 0", async () => {
    const input = JSON.stringify(makeHookInput({ tool_input: { command: "ls -la" } }));
    const { exitCode } = await runCheck(input);
    expect(exitCode).toBe(0);
  });

  it("fail-open on malformed JSON stdin", async () => {
    const { exitCode } = await runCheck("not json at all");
    expect(exitCode).toBe(0);
  });

  it("fail-open on empty stdin", async () => {
    const { exitCode } = await runCheck("");
    expect(exitCode).toBe(0);
  });

  it("denies compound command with dangerous segment", async () => {
    const input = JSON.stringify(
      makeHookInput({ tool_input: { command: "echo safe && rm -rf /" } }),
    );
    const { exitCode } = await runCheck(input);
    expect(exitCode).toBe(2);
  });

  it("allows compound command with all safe segments", async () => {
    const input = JSON.stringify(
      makeHookInput({ tool_input: { command: "git fetch && git status" } }),
    );
    const { exitCode } = await runCheck(input);
    expect(exitCode).toBe(0);
  });

  it("logs decision to session file", async () => {
    const input = JSON.stringify(makeHookInput({ tool_input: { command: "echo test" } }));
    await runCheck(input);
    const sessionsDir = join(testDir, "sessions");
    expect(existsSync(sessionsDir)).toBe(true);
    const date = new Date().toISOString().slice(0, 10);
    const logFile = join(sessionsDir, `${date}.jsonl`);
    expect(existsSync(logFile)).toBe(true);
    const lines = readFileSync(logFile, "utf-8").trim().split("\n");
    const decision = JSON.parse(lines[0]);
    expect(decision.tool).toBe("Bash");
    expect(decision.input).toBe("echo test");
  });

  it("stderr on deny contains blocked reason", async () => {
    const input = JSON.stringify(makeHookInput({ tool_input: { command: "rm -rf /home" } }));
    const { stderr } = await runCheck(input);
    expect(stderr).toContain("cc-guard");
    expect(stderr).toContain("Recursive force delete");
  });

  it("outputs JSON with hookSpecificOutput on allow", async () => {
    const input = JSON.stringify(makeHookInput({ tool_input: { command: "git log" } }));
    const { stdout } = await runCheck(input);
    const output = JSON.parse(stdout);
    expect(output.hookSpecificOutput).toBeDefined();
    expect(output.hookSpecificOutput.permissionDecision).toBe("allow");
  });
});
