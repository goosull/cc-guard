import type { Rule, HookInput, EngineResult, RulesConfig } from "./types";

/**
 * Extract all strings to match against from tool input.
 * Returns an array because some tools have multiple matchable fields
 * (e.g., Glob/Grep have both `pattern` and `path`).
 */
export function extractMatchTargets(toolName: string, toolInput: Record<string, unknown>): string[] {
  if (toolName === "Bash" && typeof toolInput.command === "string") {
    return [toolInput.command];
  }
  if (
    ["Read", "Write", "Edit"].includes(toolName) &&
    typeof toolInput.file_path === "string"
  ) {
    return [toolInput.file_path];
  }
  if (toolName === "Glob" || toolName === "Grep") {
    const targets: string[] = [];
    if (typeof toolInput.pattern === "string") targets.push(toolInput.pattern);
    if (typeof toolInput.path === "string") targets.push(toolInput.path);
    return targets.length > 0 ? targets : [JSON.stringify(toolInput)];
  }
  if (toolName === "Skill" && typeof toolInput.skill === "string") {
    return [toolInput.skill];
  }
  return [JSON.stringify(toolInput)];
}

/**
 * Backward-compat wrapper — returns the first match target.
 */
export function extractMatchTarget(toolName: string, toolInput: Record<string, unknown>): string {
  return extractMatchTargets(toolName, toolInput)[0];
}

/**
 * Normalize input before regex matching:
 * - trim whitespace
 * - collapse multiple spaces
 * - strip newlines
 */
export function normalizeInput(input: string): string {
  return input.trim().replace(/\n/g, " ").replace(/\s+/g, " ");
}

/**
 * Split compound bash commands into individual segments.
 * Handles: &&, ||, ;, | (pipe)
 * Does NOT handle subshells $() or backticks (future improvement).
 */
export function splitCompoundCommand(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let i = 0;

  while (i < command.length) {
    const ch = command[i];
    const next = command[i + 1];

    // Handle backslash escapes inside double quotes
    if (ch === "\\" && inDoubleQuote && i + 1 < command.length) {
      current += ch + command[i + 1];
      i += 2;
      continue;
    }

    // Track quote state
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
      i++;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      i++;
      continue;
    }

    // Only split when not inside quotes
    if (!inSingleQuote && !inDoubleQuote) {
      if (ch === "&" && next === "&") {
        segments.push(current.trim());
        current = "";
        i += 2;
        continue;
      }
      if (ch === "|" && next === "|") {
        segments.push(current.trim());
        current = "";
        i += 2;
        continue;
      }
      if (ch === ";") {
        segments.push(current.trim());
        current = "";
        i++;
        continue;
      }
      if (ch === "\n") {
        segments.push(current.trim());
        current = "";
        i++;
        continue;
      }
      if (ch === "|" && next !== "|") {
        segments.push(current.trim());
        current = "";
        i++;
        continue;
      }
    }

    current += ch;
    i++;
  }

  if (current.trim()) {
    segments.push(current.trim());
  }

  return segments.filter(Boolean);
}

/**
 * Try to compile and test a regex pattern against input.
 * Returns null on regex compilation error.
 */
/**
 * Try to compile and test a regex pattern against input.
 * Returns null on regex compilation error.
 * Guards against catastrophic backtracking by capping input length.
 */
const MAX_INPUT_LENGTH = 65536; // 64KB

function testPattern(pattern: string, input: string): boolean | null {
  if (input.length > MAX_INPUT_LENGTH) {
    console.error(`[cc-guard] Input too long (${input.length} chars), skipping regex match`);
    return null;
  }
  try {
    return new RegExp(pattern).test(input);
  } catch {
    console.error(`[cc-guard] Invalid regex pattern: ${pattern}`);
    return null;
  }
}

/**
 * Check a single input string against rules.
 * If toolName is provided, rules with a `tools` array are filtered to only
 * apply when the tool is in the list. Rules without `tools` apply to all tools.
 */
function checkSingle(input: string, rules: RulesConfig, toolName?: string): EngineResult {
  const normalized = normalizeInput(input);

  // Filter rules by tool scope
  const applicableDeny = toolName
    ? rules.deny.filter(r => !r.tools || r.tools.includes(toolName))
    : rules.deny;
  const applicableAllow = toolName
    ? rules.allow.filter(r => !r.tools || r.tools.includes(toolName))
    : rules.allow;

  // Deny rules first (highest priority)
  for (const rule of applicableDeny) {
    const match = testPattern(rule.pattern, normalized);
    if (match === true) {
      return {
        decision: "deny",
        reason: rule.reason ?? `Matched deny rule: ${rule.pattern}`,
        matched_pattern: rule.pattern,
      };
    }
  }

  // Allow rules
  for (const rule of applicableAllow) {
    const match = testPattern(rule.pattern, normalized);
    if (match === true) {
      return {
        decision: "allow",
        matched_pattern: rule.pattern,
      };
    }
  }

  // Default: allow (blacklist approach)
  return { decision: "default-allow" };
}

/**
 * Main engine: evaluate a tool call against rules.
 * For Bash commands, splits compound commands and checks each segment.
 * ANY segment matching deny → whole command denied.
 * For multi-field tools (Glob/Grep), ANY field matching deny → denied.
 */
export function evaluate(
  hookInput: HookInput,
  rules: RulesConfig
): EngineResult {
  const toolName = hookInput.tool_name;
  const targets = extractMatchTargets(toolName, hookInput.tool_input);

  // For Bash, check the full command first (catches patterns like "curl.*|.*bash"),
  // then split compound commands and check each segment individually.
  if (toolName === "Bash") {
    const target = targets[0];
    // Phase 1: Check full unsplit command (for patterns that span operators like pipe)
    const fullResult = checkSingle(target, rules, toolName);
    if (fullResult.decision === "deny") {
      return fullResult;
    }

    // Phase 2: Split compound commands and check each segment
    const segments = splitCompoundCommand(target);

    for (const segment of segments) {
      const result = checkSingle(segment, rules, toolName);
      if (result.decision === "deny") {
        return {
          ...result,
          reason: `${result.reason} (in compound command segment: "${segment}")`,
        };
      }
    }

    // Phase 3: If full command matched allow, use that
    if (fullResult.decision === "allow") {
      return fullResult;
    }

    // Phase 4: Check segments for allow
    for (const segment of segments) {
      const result = checkSingle(segment, rules, toolName);
      if (result.decision === "allow") {
        return result;
      }
    }

    return { decision: "default-allow" };
  }

  // Non-Bash tools: check each target — ANY deny → denied
  for (const target of targets) {
    const result = checkSingle(target, rules, toolName);
    if (result.decision === "deny") {
      return result;
    }
  }

  // Check for allow matches
  for (const target of targets) {
    const result = checkSingle(target, rules, toolName);
    if (result.decision === "allow") {
      return result;
    }
  }

  return { decision: "default-allow" };
}
