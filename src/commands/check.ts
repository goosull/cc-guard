import { evaluate } from "../engine";
import { loadRules } from "../rules";
import { logDecision } from "../logger";
import type { HookInput, Decision } from "../types";

export async function cmdCheck(): Promise<void> {
  let hookInput: HookInput;

  try {
    const raw = await Bun.stdin.text();
    hookInput = JSON.parse(raw);
  } catch {
    // Malformed input — fail-open
    process.exit(0);
  }

  if (!hookInput.tool_name || !hookInput.tool_input) {
    process.exit(0);
  }

  let rules;
  try {
    rules = await loadRules();
  } catch {
    // Can't load rules — fail-open
    process.exit(0);
  }

  const result = evaluate(hookInput, rules);

  // Extract input string for logging
  let inputStr = "";
  if (hookInput.tool_name === "Bash" && typeof hookInput.tool_input.command === "string") {
    inputStr = hookInput.tool_input.command;
  } else if (typeof hookInput.tool_input.file_path === "string") {
    inputStr = hookInput.tool_input.file_path;
  } else {
    inputStr = JSON.stringify(hookInput.tool_input).slice(0, 500);
  }

  const decision: Decision = {
    ts: new Date().toISOString(),
    tool: hookInput.tool_name,
    input: inputStr,
    decision: result.decision,
    source: result.decision === "default-allow" ? "default" : "rule",
    matched_pattern: result.matched_pattern,
    reason: result.reason,
  };

  logDecision(decision);

  if (result.decision === "deny") {
    const msg = result.reason ?? "Blocked by cc-guard deny rule";
    process.stderr.write(`[cc-guard] ${msg}\n`);
    process.exit(2);
  }

  // Allow or default-allow — output JSON and exit 0
  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: result.matched_pattern
        ? `cc-guard: matched allow rule ${result.matched_pattern}`
        : "cc-guard: default allow (no matching rule)",
    },
  });
  process.stdout.write(output);
  process.exit(0);
}
