import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { parseLlmResponse, buildStats, buildPrompt, sampleDecisions } from "../../src/commands/learn";
import type { Decision } from "../../src/types";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `cc-guard-test-learn-${Date.now()}`);
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

// === parseLlmResponse ===

describe("parseLlmResponse", () => {
  it("parses valid JSON array", () => {
    const response = `[{"action": "add_allow", "pattern": "^npm ", "reason": "safe", "confidence": "high"}]`;
    const result = parseLlmResponse(response);
    expect(result).toHaveLength(1);
    expect(result[0].pattern).toBe("^npm ");
  });

  it("extracts JSON array embedded in prose", () => {
    const response = `Here are my suggestions:\n[{"action": "add_allow", "pattern": "^npm ", "reason": "safe", "confidence": "high"}]\nHope this helps!`;
    const result = parseLlmResponse(response);
    expect(result).toHaveLength(1);
  });

  it("returns [] for non-JSON text", () => {
    expect(parseLlmResponse("No suggestions needed.")).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseLlmResponse("[{broken json")).toEqual([]);
  });

  it("filters suggestions missing required fields", () => {
    const response = `[
      {"action": "add_allow", "pattern": "^npm ", "reason": "safe", "confidence": "high"},
      {"action": "add_allow", "pattern": "^yarn "},
      {"just": "garbage"}
    ]`;
    const result = parseLlmResponse(response);
    expect(result).toHaveLength(1); // only first has all 4 fields
  });

  it("two JSON arrays in response returns [] (greedy regex)", () => {
    const response = `Suggestions: [{"action":"add_allow","pattern":"^npm ","reason":"safe","confidence":"high"}]\nBut avoid: ["bad"]`;
    const result = parseLlmResponse(response);
    // Greedy regex captures from first [ to last ] — JSON.parse fails
    // This documents the known edge case
    expect(result).toEqual([]);
  });

  it("returns [] when response is just an object (not array)", () => {
    const response = `{"action": "add_allow", "pattern": "^npm "}`;
    expect(parseLlmResponse(response)).toEqual([]);
  });
});

// === buildStats ===

describe("buildStats", () => {
  it("counts allow/deny/default-allow correctly", () => {
    const decisions: Decision[] = [
      makeDecision({ decision: "allow" }),
      makeDecision({ decision: "allow" }),
      makeDecision({ decision: "deny" }),
      makeDecision({ decision: "default-allow" }),
    ];
    const stats = buildStats(decisions);
    expect(stats.total).toBe(4);
    expect(stats.allowed).toBe(3); // allow + default-allow
    expect(stats.denied).toBe(1);
    expect(stats.defaultAllowed).toBe(1);
  });

  it("computes top prefixes from default-allowed commands", () => {
    const decisions: Decision[] = [
      makeDecision({ input: "npm install", decision: "default-allow" }),
      makeDecision({ input: "npm test", decision: "default-allow" }),
      makeDecision({ input: "yarn add foo", decision: "default-allow" }),
    ];
    const stats = buildStats(decisions);
    expect(stats.topPrefixes[0][0]).toBe("npm");
    expect(stats.topPrefixes[0][1]).toBe(2);
    expect(stats.topPrefixes[1][0]).toBe("yarn");
    expect(stats.topPrefixes[1][1]).toBe(1);
  });

  it("handles empty decisions array", () => {
    const stats = buildStats([]);
    expect(stats.total).toBe(0);
    expect(stats.allowed).toBe(0);
    expect(stats.denied).toBe(0);
    expect(stats.sessionCount).toBe(0);
  });

  it("sessionCount counts unique calendar days, not sessions", () => {
    const decisions: Decision[] = [
      makeDecision({ ts: "2025-01-15T10:00:00Z" }),
      makeDecision({ ts: "2025-01-15T14:00:00Z" }), // same day
      makeDecision({ ts: "2025-01-16T09:00:00Z" }), // different day
    ];
    const stats = buildStats(decisions);
    expect(stats.sessionCount).toBe(2); // 2 unique days
  });

  it("multiple decisions same day counts as 1 session", () => {
    const decisions: Decision[] = Array.from({ length: 50 }, (_, i) =>
      makeDecision({ ts: `2025-01-15T${String(i % 24).padStart(2, "0")}:00:00Z` }),
    );
    const stats = buildStats(decisions);
    expect(stats.sessionCount).toBe(1); // all same day
  });
});

// === buildPrompt ===

describe("buildPrompt", () => {
  it("includes current rules YAML", () => {
    const decisions = [makeDecision()];
    const stats = buildStats(decisions);
    const prompt = buildPrompt(decisions, "deny:\n  - pattern: ^sudo\n", stats);
    expect(prompt).toContain("^sudo");
    expect(prompt).toContain("Current Rules");
  });

  it("includes stats summary", () => {
    const decisions = [
      makeDecision({ decision: "allow" }),
      makeDecision({ decision: "deny" }),
    ];
    const stats = buildStats(decisions);
    const prompt = buildPrompt(decisions, "", stats);
    expect(prompt).toContain("Total decisions: 2");
  });

  it("uses strategic sampling for large decision sets", () => {
    const decisions = Array.from({ length: 500 }, (_, i) =>
      makeDecision({ input: `cmd-${i}` }),
    );
    const stats = buildStats(decisions);
    const prompt = buildPrompt(decisions, "", stats);
    // Should contain "200 of 500" in the header
    expect(prompt).toContain("200 of 500");
  });

  it("full mode includes all decisions", () => {
    const decisions = Array.from({ length: 500 }, (_, i) =>
      makeDecision({ input: `cmd-${i}` }),
    );
    const stats = buildStats(decisions);
    const prompt = buildPrompt(decisions, "", stats, true);
    // Should contain "500 of 500"
    expect(prompt).toContain("500 of 500");
  });

  it("includes top prefixes", () => {
    const decisions = [
      makeDecision({ input: "npm install", decision: "default-allow" }),
      makeDecision({ input: "npm test", decision: "default-allow" }),
    ];
    const stats = buildStats(decisions);
    const prompt = buildPrompt(decisions, "", stats);
    expect(prompt).toContain("npm");
  });
});

// === sampleDecisions ===

describe("sampleDecisions", () => {
  it("returns all decisions when under maxSample", () => {
    const decisions = Array.from({ length: 50 }, (_, i) =>
      makeDecision({ input: `cmd-${i}` }),
    );
    const sample = sampleDecisions(decisions, 200);
    expect(sample.length).toBe(50);
  });

  it("caps at maxSample for large sets", () => {
    const decisions = Array.from({ length: 1000 }, (_, i) =>
      makeDecision({ input: `cmd-${i}`, decision: "default-allow" }),
    );
    const sample = sampleDecisions(decisions, 200);
    expect(sample.length).toBeLessThanOrEqual(200);
  });

  it("prioritizes denied decisions", () => {
    const decisions = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeDecision({ input: `deny-${i}`, decision: "deny" }),
      ),
      ...Array.from({ length: 500 }, (_, i) =>
        makeDecision({ input: `allow-${i}`, decision: "default-allow" }),
      ),
    ];
    const sample = sampleDecisions(decisions, 50);
    const deniedInSample = sample.filter(d => d.decision === "deny");
    // All 5 denied should be included (within 30% budget = 15)
    expect(deniedInSample.length).toBe(5);
  });

  it("stratifies across dates for default-allowed", () => {
    const decisions = [
      ...Array.from({ length: 100 }, (_, i) =>
        makeDecision({ input: `day1-${i}`, decision: "default-allow", ts: "2025-01-15T10:00:00Z" }),
      ),
      ...Array.from({ length: 100 }, (_, i) =>
        makeDecision({ input: `day2-${i}`, decision: "default-allow", ts: "2025-01-16T10:00:00Z" }),
      ),
      ...Array.from({ length: 100 }, (_, i) =>
        makeDecision({ input: `day3-${i}`, decision: "default-allow", ts: "2025-01-17T10:00:00Z" }),
      ),
    ];
    const sample = sampleDecisions(decisions, 30);
    // Should have samples from all 3 days
    const days = new Set(sample.map(d => d.ts.slice(0, 10)));
    expect(days.size).toBe(3);
  });

  it("handles single-day history", () => {
    const decisions = Array.from({ length: 500 }, (_, i) =>
      makeDecision({
        input: `cmd-${i}`,
        decision: "default-allow",
        ts: "2025-01-15T10:00:00Z",
      }),
    );
    const sample = sampleDecisions(decisions, 100);
    expect(sample.length).toBeLessThanOrEqual(100);
    expect(sample.length).toBeGreaterThan(0);
  });

  it("default maxSample is 200", () => {
    const decisions = Array.from({ length: 500 }, (_, i) =>
      makeDecision({ input: `cmd-${i}`, decision: "default-allow" }),
    );
    const sample = sampleDecisions(decisions);
    expect(sample.length).toBeLessThanOrEqual(200);
  });
});
