import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { logDecision } from "../src/logger";
import { mkdirSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Decision } from "../src/types";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `cc-guard-test-logger-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  process.env.CC_GUARD_DIR = testDir;
});

afterEach(() => {
  delete process.env.CC_GUARD_DIR;
  rmSync(testDir, { recursive: true, force: true });
});

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    ts: "2025-01-15T10:30:00Z",
    tool: "Bash",
    input: "git status",
    decision: "allow",
    source: "rule",
    ...overrides,
  };
}

describe("logDecision", () => {
  it("creates sessions/ directory on first write", () => {
    logDecision(makeDecision());
    expect(existsSync(join(testDir, "sessions"))).toBe(true);
  });

  it("writes Decision as JSON line to YYYY-MM-DD.jsonl", () => {
    logDecision(makeDecision());
    const date = new Date().toISOString().slice(0, 10);
    const logPath = join(testDir, "sessions", `${date}.jsonl`);
    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, "utf-8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.tool).toBe("Bash");
    expect(parsed.input).toBe("git status");
  });

  it("appends to existing file (multiple decisions same day)", () => {
    logDecision(makeDecision({ input: "first" }));
    logDecision(makeDecision({ input: "second" }));
    const date = new Date().toISOString().slice(0, 10);
    const logPath = join(testDir, "sessions", `${date}.jsonl`);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).input).toBe("first");
    expect(JSON.parse(lines[1]).input).toBe("second");
  });

  it("handles Decision with all optional fields", () => {
    logDecision(
      makeDecision({
        matched_pattern: "^git ",
        reason: "Matched allow rule",
      }),
    );
    const date = new Date().toISOString().slice(0, 10);
    const logPath = join(testDir, "sessions", `${date}.jsonl`);
    const parsed = JSON.parse(readFileSync(logPath, "utf-8").trim());
    expect(parsed.matched_pattern).toBe("^git ");
    expect(parsed.reason).toBe("Matched allow rule");
  });

  it("JSON output is valid and parseable back to Decision", () => {
    const original = makeDecision({
      decision: "deny",
      source: "rule",
      matched_pattern: "^sudo ",
      reason: "Elevated privileges",
    });
    logDecision(original);
    const date = new Date().toISOString().slice(0, 10);
    const logPath = join(testDir, "sessions", `${date}.jsonl`);
    const parsed = JSON.parse(readFileSync(logPath, "utf-8").trim());
    expect(parsed.ts).toBe(original.ts);
    expect(parsed.tool).toBe(original.tool);
    expect(parsed.input).toBe(original.input);
    expect(parsed.decision).toBe(original.decision);
    expect(parsed.source).toBe(original.source);
  });

  it("silent failure when CC_GUARD_DIR points to nonexistent path", () => {
    process.env.CC_GUARD_DIR = "/nonexistent/path/that/does/not/exist";
    // Should not throw
    expect(() => logDecision(makeDecision())).not.toThrow();
  });

  it("uses today's date for file naming", () => {
    logDecision(makeDecision());
    const date = new Date().toISOString().slice(0, 10);
    const logPath = join(testDir, "sessions", `${date}.jsonl`);
    expect(existsSync(logPath)).toBe(true);
  });
});
