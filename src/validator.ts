import type { Rule, RulesConfig, Decision } from "./types";

export interface RuleSuggestion {
  action: "add_allow" | "add_deny" | "remove_allow";
  pattern: string;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate a single regex pattern.
 */
function validateRegex(pattern: string): ValidationResult {
  try {
    new RegExp(pattern);
    return { valid: true };
  } catch (e) {
    return { valid: false, reason: `Invalid regex: ${(e as Error).message}` };
  }
}

/**
 * Check if an allow suggestion conflicts with existing deny rules.
 */
function checkDenyConflict(pattern: string, denyRules: Rule[]): ValidationResult {
  // Test if the suggested allow pattern matches anything that deny rules also match
  const testCases = denyRules.map((r) => {
    // Generate a synthetic string that would match the deny rule
    // This is a heuristic — we test if the new allow regex also matches deny patterns
    try {
      const denyRegex = new RegExp(r.pattern);
      const allowRegex = new RegExp(pattern);
      // Simple overlap check: if both patterns start with the same prefix
      // A more thorough check would use formal regex intersection, but this catches common cases
      const commonPrefixes = ["rm -rf ", "sudo ", "git push --force", "git reset --hard", "chmod 777"];
      for (const prefix of commonPrefixes) {
        if (allowRegex.test(prefix) && denyRegex.test(prefix)) {
          return {
            valid: false,
            reason: `Allow pattern "${pattern}" conflicts with deny rule "${r.pattern}" — both match "${prefix}"`,
          };
        }
      }
    } catch {
      // Skip invalid patterns
    }
    return { valid: true };
  });

  const conflict = testCases.find((r) => !r.valid);
  return conflict ?? { valid: true };
}

/**
 * Validate a suggestion against session history (back-testing).
 */
function backtest(
  suggestion: RuleSuggestion,
  decisions: Decision[],
): ValidationResult {
  if (suggestion.action !== "add_allow") return { valid: true };

  const regex = new RegExp(suggestion.pattern);
  const wouldAllow = decisions.filter(
    (d) => d.decision === "deny" && regex.test(d.input),
  );

  if (wouldAllow.length > 0) {
    return {
      valid: false,
      reason: `Would override ${wouldAllow.length} previous deny decisions (e.g., "${wouldAllow[0].input}")`,
    };
  }

  return { valid: true };
}

/**
 * Validate all suggestions. Returns only the valid ones.
 */
export function validateSuggestions(
  suggestions: RuleSuggestion[],
  currentRules: RulesConfig,
  decisions: Decision[],
  confidenceThreshold: "low" | "medium" | "high",
): { accepted: RuleSuggestion[]; rejected: Array<{ suggestion: RuleSuggestion; reason: string }> } {
  const thresholdOrder = { low: 0, medium: 1, high: 2 };
  const minConfidence = thresholdOrder[confidenceThreshold];

  const accepted: RuleSuggestion[] = [];
  const rejected: Array<{ suggestion: RuleSuggestion; reason: string }> = [];

  for (const suggestion of suggestions) {
    // 1. Confidence filter
    if (thresholdOrder[suggestion.confidence] < minConfidence) {
      rejected.push({ suggestion, reason: `Below confidence threshold (${suggestion.confidence} < ${confidenceThreshold})` });
      continue;
    }

    // 2. Regex syntax validation
    const regexCheck = validateRegex(suggestion.pattern);
    if (!regexCheck.valid) {
      rejected.push({ suggestion, reason: regexCheck.reason! });
      continue;
    }

    // 3. Deny conflict check (only for allow suggestions)
    if (suggestion.action === "add_allow") {
      const conflictCheck = checkDenyConflict(suggestion.pattern, currentRules.deny);
      if (!conflictCheck.valid) {
        rejected.push({ suggestion, reason: conflictCheck.reason! });
        continue;
      }
    }

    // 4. Back-test against session history
    const backtestCheck = backtest(suggestion, decisions);
    if (!backtestCheck.valid) {
      rejected.push({ suggestion, reason: backtestCheck.reason! });
      continue;
    }

    accepted.push(suggestion);
  }

  return { accepted, rejected };
}
