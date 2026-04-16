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
  } else if (typeof hookInput.tool_input.pattern === "string") {
    const path = typeof hookInput.tool_input.path === "string" ? hookInput.tool_input.path : "";
    inputStr = path ? `${hookInput.tool_input.pattern} (in ${path})` : hookInput.tool_input.pattern;
  } else if (typeof hookInput.tool_input.skill === "string") {
    inputStr = hookInput.tool_input.skill;
  } else {
    inputStr = JSON.stringify(hookInput.tool_input).slice(0, 500);
  }

  // Temp-allow loop: if denied, check temp-allow for the matched pattern.
  // If consumed, re-evaluate (compound commands may have other denied segments).
  // Loop until either: no deny, or deny with no temp-allow.
  let currentResult = result;
  const consumedPatterns: string[] = [];
  const MAX_TEMP_ALLOW_LOOPS = 10; // Safety cap

  if (currentResult.decision === "deny") {
    const { consumeTempAllow, hasTempAllow } = await import("../temp-allows");

    // Phase 1: Dry-run — check which deny patterns have temp-allows (without consuming)
    for (let i = 0; i < MAX_TEMP_ALLOW_LOOPS; i++) {
      const pattern = currentResult.matched_pattern ?? "";
      if (!pattern || !hasTempAllow(pattern)) {
        break; // No temp-allow for this deny — stop looping
      }
      consumedPatterns.push(pattern);
      const filteredRules = {
        ...rules,
        deny: rules.deny.filter(r => !consumedPatterns.includes(r.pattern)),
      };
      currentResult = evaluate(hookInput, filteredRules);
      if (currentResult.decision !== "deny") {
        break;
      }
    }

    // Phase 2: Only consume if ALL denies were resolved
    if (consumedPatterns.length > 0 && currentResult.decision !== "deny") {
      for (const pattern of consumedPatterns) {
        consumeTempAllow(pattern);
      }
    } else {
      // Some deny was not overridden — don't consume any temp-allows
      consumedPatterns.length = 0;
    }
  }

  if (consumedPatterns.length > 0 && currentResult.decision !== "deny") {
    // Temp-allow(s) overrode all deny matches
    const taDecision: Decision = {
      ts: new Date().toISOString(),
      tool: hookInput.tool_name,
      input: inputStr,
      decision: "allow",
      source: "temp-allow",
      matched_pattern: consumedPatterns.join(", "),
    };
    logDecision(taDecision);
    const output = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: `cc-guard: temp-allow override for ${consumedPatterns.join(", ")}`,
      },
    });
    process.stdout.write(output);
    process.exit(0);
  }

  if (currentResult.decision === "deny") {
    const pattern = currentResult.matched_pattern ?? "";
    const reason = currentResult.reason ?? "Blocked by cc-guard deny rule";

    logDecision({
      ts: new Date().toISOString(),
      tool: hookInput.tool_name,
      input: inputStr,
      decision: "deny",
      source: "rule",
      matched_pattern: pattern,
      reason,
    });

    process.stderr.write(
      `[cc-guard] BLOCKED: ${reason} (pattern: ${pattern})\n` +
      `  \u2192 Allow once:    cc-guard allow-once "${pattern}"\n` +
      `  \u2192 Allow session: cc-guard allow-session "${pattern}"\n`
    );
    process.exit(2);
  }

  // Allow or default-allow — log and output JSON
  logDecision({
    ts: new Date().toISOString(),
    tool: hookInput.tool_name,
    input: inputStr,
    decision: currentResult.decision,
    source: currentResult.decision === "default-allow" ? "default" : "rule",
    matched_pattern: currentResult.matched_pattern,
    reason: currentResult.reason,
  });

  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: currentResult.matched_pattern
        ? `cc-guard: matched allow rule ${currentResult.matched_pattern}`
        : "cc-guard: default allow (no matching rule)",
    },
  });
  process.stdout.write(output);
  process.exit(0);
}
