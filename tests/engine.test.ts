import { describe, it, expect } from "bun:test";
import {
  evaluate,
  extractMatchTarget,
  extractMatchTargets,
  normalizeInput,
  splitCompoundCommand,
} from "../src/engine";
import type { HookInput, RulesConfig } from "../src/types";

const defaultRules: RulesConfig = {
  version: 1,
  deny: [
    { pattern: "^rm -rf ", reason: "Recursive force delete" },
    { pattern: "git push --force", reason: "Force push" },
    { pattern: "git reset --hard", reason: "Hard reset" },
    { pattern: "^sudo ", reason: "Elevated privileges" },
  ],
  allow: [
    { pattern: "^git " },
    { pattern: "^pnpm " },
  ],
};

function bashInput(command: string): HookInput {
  return {
    session_id: "test",
    tool_name: "Bash",
    tool_input: { command },
    cwd: "/tmp",
    hook_event_name: "PreToolUse",
  };
}

// === extractMatchTarget ===

describe("extractMatchTarget", () => {
  it("extracts command from Bash", () => {
    expect(extractMatchTarget("Bash", { command: "git status" })).toBe("git status");
  });

  it("extracts file_path from Read", () => {
    expect(extractMatchTarget("Read", { file_path: "/tmp/foo.ts" })).toBe("/tmp/foo.ts");
  });

  it("falls back to JSON for unknown tools", () => {
    expect(extractMatchTarget("CustomTool", { foo: "bar" })).toBe('{"foo":"bar"}');
  });
});

// === extractMatchTargets (multi-field) ===

describe("extractMatchTargets", () => {
  it("returns [command] for Bash", () => {
    expect(extractMatchTargets("Bash", { command: "ls -la" })).toEqual(["ls -la"]);
  });

  it("returns [file_path] for Read", () => {
    expect(extractMatchTargets("Read", { file_path: "/tmp/foo" })).toEqual(["/tmp/foo"]);
  });

  it("returns [file_path] for Write", () => {
    expect(extractMatchTargets("Write", { file_path: "/tmp/bar" })).toEqual(["/tmp/bar"]);
  });

  it("returns [file_path] for Edit", () => {
    expect(extractMatchTargets("Edit", { file_path: "/tmp/baz" })).toEqual(["/tmp/baz"]);
  });

  it("returns [pattern, path] for Glob with both fields", () => {
    const targets = extractMatchTargets("Glob", { pattern: "**/*.ts", path: "/home/user" });
    expect(targets).toEqual(["**/*.ts", "/home/user"]);
  });

  it("returns [pattern] for Glob with pattern only", () => {
    expect(extractMatchTargets("Glob", { pattern: "*.env" })).toEqual(["*.env"]);
  });

  it("returns [pattern, path] for Grep with both fields", () => {
    const targets = extractMatchTargets("Grep", { pattern: "password", path: "/etc" });
    expect(targets).toEqual(["password", "/etc"]);
  });

  it("returns [skill] for Skill", () => {
    expect(extractMatchTargets("Skill", { skill: "ship" })).toEqual(["ship"]);
  });

  it("returns [JSON] for unknown tool", () => {
    expect(extractMatchTargets("Agent", { prompt: "hello" })).toEqual(['{"prompt":"hello"}']);
  });

  it("returns [JSON] for Glob with no pattern or path", () => {
    const targets = extractMatchTargets("Glob", { something: "else" });
    expect(targets).toEqual(['{"something":"else"}']);
  });
});

// === tool-scoped rules ===

describe("tool-scoped rules", () => {
  it("file-path deny rule with tools scope does not match Bash", () => {
    const rules: RulesConfig = {
      version: 1,
      deny: [{ pattern: "\\.env$", reason: "env file", tools: ["Read", "Write", "Edit"] }],
      allow: [],
    };
    const result = evaluate(bashInput("cat .env"), rules);
    expect(result.decision).not.toBe("deny");
  });

  it("file-path deny rule with tools scope matches Read", () => {
    const rules: RulesConfig = {
      version: 1,
      deny: [{ pattern: "\\.env$", reason: "env file", tools: ["Read", "Write", "Edit"] }],
      allow: [],
    };
    const input: HookInput = {
      session_id: "test",
      tool_name: "Read",
      tool_input: { file_path: "/home/user/.env" },
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
    };
    const result = evaluate(input, rules);
    expect(result.decision).toBe("deny");
  });

  it("rule without tools field applies to all tools", () => {
    const rules: RulesConfig = {
      version: 1,
      deny: [{ pattern: "/etc/passwd", reason: "system file" }],
      allow: [],
    };
    const input: HookInput = {
      session_id: "test",
      tool_name: "Read",
      tool_input: { file_path: "/etc/passwd" },
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
    };
    const result = evaluate(input, rules);
    expect(result.decision).toBe("deny");
  });

  it("Glob path field is checked against deny rules", () => {
    const rules: RulesConfig = {
      version: 1,
      deny: [{ pattern: "\\.ssh/", reason: "SSH dir", tools: ["Glob", "Grep"] }],
      allow: [],
    };
    const input: HookInput = {
      session_id: "test",
      tool_name: "Glob",
      tool_input: { pattern: "*.ts", path: "/home/user/.ssh/" },
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
    };
    const result = evaluate(input, rules);
    expect(result.decision).toBe("deny");
  });

  it("Grep path field is checked against deny rules", () => {
    const rules: RulesConfig = {
      version: 1,
      deny: [{ pattern: "/etc/shadow", reason: "shadow file" }],
      allow: [],
    };
    const input: HookInput = {
      session_id: "test",
      tool_name: "Grep",
      tool_input: { pattern: "root", path: "/etc/shadow" },
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
    };
    const result = evaluate(input, rules);
    expect(result.decision).toBe("deny");
  });

  it("Skill tool default-allows when no deny rule matches", () => {
    const rules: RulesConfig = {
      version: 1,
      deny: [{ pattern: "^rm -rf ", reason: "dangerous" }],
      allow: [],
    };
    const input: HookInput = {
      session_id: "test",
      tool_name: "Skill",
      tool_input: { skill: "ship" },
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
    };
    const result = evaluate(input, rules);
    expect(result.decision).toBe("default-allow");
  });
});

// === normalizeInput ===

describe("normalizeInput", () => {
  it("trims whitespace", () => {
    expect(normalizeInput("  git status  ")).toBe("git status");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeInput("git   status    --short")).toBe("git status --short");
  });

  it("strips newlines", () => {
    expect(normalizeInput("echo foo\nrm -rf /")).toBe("echo foo rm -rf /");
  });
});

// === splitCompoundCommand ===

describe("splitCompoundCommand", () => {
  it("splits on &&", () => {
    expect(splitCompoundCommand("cd /tmp && rm -rf /")).toEqual(["cd /tmp", "rm -rf /"]);
  });

  it("splits on ||", () => {
    expect(splitCompoundCommand("test -f foo || exit 1")).toEqual(["test -f foo", "exit 1"]);
  });

  it("splits on ;", () => {
    expect(splitCompoundCommand("echo a; echo b; echo c")).toEqual(["echo a", "echo b", "echo c"]);
  });

  it("splits on pipe", () => {
    expect(splitCompoundCommand("cat file | grep foo")).toEqual(["cat file", "grep foo"]);
  });

  it("handles mixed operators", () => {
    expect(splitCompoundCommand("a && b || c; d | e")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("respects double quotes", () => {
    expect(splitCompoundCommand('echo "a && b" && rm x')).toEqual(['echo "a && b"', "rm x"]);
  });

  it("respects single quotes", () => {
    expect(splitCompoundCommand("echo 'a || b' || exit")).toEqual(["echo 'a || b'", "exit"]);
  });

  it("handles single command", () => {
    expect(splitCompoundCommand("git status")).toEqual(["git status"]);
  });

  it("handles empty string", () => {
    expect(splitCompoundCommand("")).toEqual([]);
  });
});

// === evaluate — deny ===

describe("evaluate deny", () => {
  it("denies rm -rf", () => {
    const result = evaluate(bashInput("rm -rf /tmp/build"), defaultRules);
    expect(result.decision).toBe("deny");
    expect(result.matched_pattern).toBe("^rm -rf ");
  });

  it("denies force push", () => {
    const result = evaluate(bashInput("git push --force origin main"), defaultRules);
    expect(result.decision).toBe("deny");
  });

  it("denies hard reset", () => {
    const result = evaluate(bashInput("git reset --hard HEAD~1"), defaultRules);
    expect(result.decision).toBe("deny");
  });

  it("denies sudo", () => {
    const result = evaluate(bashInput("sudo apt install curl"), defaultRules);
    expect(result.decision).toBe("deny");
  });
});

// === evaluate — allow ===

describe("evaluate allow", () => {
  it("allows git commands", () => {
    const result = evaluate(bashInput("git status"), defaultRules);
    expect(result.decision).toBe("allow");
    expect(result.matched_pattern).toBe("^git ");
  });

  it("allows pnpm commands", () => {
    const result = evaluate(bashInput("pnpm install"), defaultRules);
    expect(result.decision).toBe("allow");
  });
});

// === evaluate — default-allow ===

describe("evaluate default-allow", () => {
  it("default-allows unmatched commands", () => {
    const result = evaluate(bashInput("echo hello"), defaultRules);
    expect(result.decision).toBe("default-allow");
  });

  it("default-allows with empty rules", () => {
    const result = evaluate(bashInput("ls -la"), { version: 1, deny: [], allow: [] });
    expect(result.decision).toBe("default-allow");
  });
});

// === evaluate — compound commands ===

describe("evaluate compound commands", () => {
  it("denies compound with dangerous segment", () => {
    const result = evaluate(bashInput("cd /tmp && rm -rf /"), defaultRules);
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("compound command");
  });

  it("allows compound with all safe segments", () => {
    const result = evaluate(bashInput("git fetch && git status"), defaultRules);
    expect(result.decision).toBe("allow");
  });

  it("denies piped dangerous command", () => {
    const result = evaluate(bashInput("echo ok | sudo rm -rf /"), defaultRules);
    expect(result.decision).toBe("deny");
  });
});

// === evaluate — deny > allow priority ===

describe("deny takes priority over allow", () => {
  it("denies git push --force even though git is allowed", () => {
    const result = evaluate(bashInput("git push --force"), defaultRules);
    expect(result.decision).toBe("deny");
  });

  it("denies git reset --hard even though git is allowed", () => {
    const result = evaluate(bashInput("git reset --hard"), defaultRules);
    expect(result.decision).toBe("deny");
  });
});

// === evaluate — edge cases ===

describe("edge cases", () => {
  it("handles leading whitespace", () => {
    const result = evaluate(bashInput("  rm -rf /tmp"), defaultRules);
    expect(result.decision).toBe("deny");
  });

  it("handles invalid regex in rules gracefully", () => {
    const badRules: RulesConfig = {
      version: 1,
      deny: [{ pattern: "[invalid(regex", reason: "bad" }],
      allow: [],
    };
    const result = evaluate(bashInput("anything"), badRules);
    // Should not crash — skip bad rule, default-allow
    expect(result.decision).toBe("default-allow");
  });

  it("handles non-Bash tools", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Read",
      tool_input: { file_path: "/etc/passwd" },
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
    };
    const rules: RulesConfig = {
      version: 1,
      deny: [{ pattern: "/etc/passwd", reason: "Sensitive file" }],
      allow: [],
    };
    const result = evaluate(input, rules);
    expect(result.decision).toBe("deny");
  });
});
