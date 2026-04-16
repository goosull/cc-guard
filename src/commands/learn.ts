import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { stringify } from "yaml";
import Anthropic from "@anthropic-ai/sdk";
import { getCcGuardDir, loadRules } from "../rules";
import { loadConfig } from "../config";
import { validateSuggestions, type RuleSuggestion } from "../validator";
import type { Decision } from "../types";

function loadAllDecisions(): Decision[] {
  const sessionsDir = join(getCcGuardDir(), "sessions");
  const decisions: Decision[] = [];

  let files: string[];
  try {
    files = readdirSync(sessionsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse();
  } catch {
    return [];
  }

  for (const file of files) {
    try {
      const lines = readFileSync(join(sessionsDir, file), "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const line of lines) {
        try {
          decisions.push(JSON.parse(line));
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      continue;
    }
  }

  return decisions;
}

function buildStats(decisions: Decision[]) {
  const allowed = decisions.filter((d) => d.decision === "allow" || d.decision === "default-allow");
  const denied = decisions.filter((d) => d.decision === "deny");
  const defaultAllowed = decisions.filter((d) => d.decision === "default-allow");

  // Group default-allowed by first word (command prefix)
  const prefixCounts = new Map<string, number>();
  for (const d of defaultAllowed) {
    const prefix = d.input.split(/\s+/)[0] ?? "unknown";
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
  }

  // Sort by frequency
  const topPrefixes = [...prefixCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  return {
    total: decisions.length,
    allowed: allowed.length,
    denied: denied.length,
    defaultAllowed: defaultAllowed.length,
    topPrefixes,
    sessionCount: new Set(decisions.map((d) => d.ts.slice(0, 10))).size,
  };
}

function buildPrompt(decisions: Decision[], currentRulesYaml: string, stats: ReturnType<typeof buildStats>): string {
  // Sample recent decisions (max 100)
  const sample = decisions.slice(0, 100);

  return `You are analyzing Claude Code permission decisions to suggest rule improvements for cc-guard, a regex-based permission guard.

## Current Rules
\`\`\`yaml
${currentRulesYaml}
\`\`\`

## Session Statistics
- Total decisions: ${stats.total}
- Allowed (by rule): ${stats.allowed - stats.defaultAllowed}
- Default-allowed (no matching rule): ${stats.defaultAllowed}
- Denied: ${stats.denied}
- Sessions: ${stats.sessionCount} days

## Most Frequent Default-Allowed Commands (no rule matched)
${stats.topPrefixes.map(([prefix, count]) => `- "${prefix}" — ${count} times`).join("\n")}

## Recent Decisions (sample)
${sample.map((d) => `${d.decision.padEnd(14)} | ${d.source.padEnd(7)} | ${d.tool}: ${d.input.slice(0, 100)}`).join("\n")}

## Your Task

Analyze these patterns and suggest rule changes. For each suggestion:
1. The regex pattern
2. Whether to add it as "allow" or "deny"
3. Your reasoning
4. Confidence level (high/medium/low)

Guidelines:
- Commands that appear 3+ times as "default-allow" are candidates for explicit allow rules
- Look for patterns you can generalize (e.g., many "git ..." commands → "^git ")
- NEVER suggest allow patterns that would match dangerous commands (rm -rf, sudo, force push)
- Be conservative — high confidence only for clear patterns
- Prefer broader patterns over specific ones (^pnpm over ^pnpm --filter web)

Respond with ONLY a JSON array of suggestions, no other text:
[
  {"action": "add_allow", "pattern": "^git ", "reason": "Git commands appear 15 times, all safe", "confidence": "high"},
  {"action": "add_deny", "pattern": "DROP TABLE", "reason": "SQL destructive operation", "confidence": "medium"}
]`;
}

function parseLlmResponse(text: string): RuleSuggestion[] {
  // Extract JSON array from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s: unknown): s is RuleSuggestion =>
        typeof s === "object" &&
        s !== null &&
        "action" in s &&
        "pattern" in s &&
        "reason" in s &&
        "confidence" in s,
    );
  } catch {
    return [];
  }
}

export async function cmdLearn(): Promise<void> {
  const config = await loadConfig();
  const rules = await loadRules();
  const decisions = loadAllDecisions();

  if (decisions.length === 0) {
    console.log("No session data yet. Use Claude Code for a while and try again.");
    return;
  }

  const stats = buildStats(decisions);
  console.log(`Analyzing ${stats.total} decisions across ${stats.sessionCount} sessions...`);
  console.log(`  Allowed: ${stats.allowed} | Denied: ${stats.denied} | Default: ${stats.defaultAllowed}`);

  if (stats.sessionCount < config.learning.min_sessions) {
    console.log(`\nNeed at least ${config.learning.min_sessions} sessions for learning. Currently: ${stats.sessionCount}.`);
    console.log("Keep using Claude Code and try again later.");
    return;
  }

  // Build prompt and call LLM
  const rulesYaml = stringify(rules);
  const prompt = buildPrompt(decisions, rulesYaml, stats);

  console.log("\nCalling LLM for analysis...");

  const apiKey = process.env[config.llm.api_key_env];
  if (!apiKey) {
    console.error(`Error: ${config.llm.api_key_env} environment variable not set.`);
    console.error(`Set it: export ${config.llm.api_key_env}="your-api-key"`);
    process.exit(1);
  }

  let responseText: string;
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: config.llm.model,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
    responseText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  } catch (e) {
    console.error(`LLM API error: ${(e as Error).message}`);
    process.exit(1);
  }

  // Parse suggestions
  const suggestions = parseLlmResponse(responseText);
  if (suggestions.length === 0) {
    console.log("\nLLM returned no suggestions. Your rules look good as-is.");
    return;
  }

  console.log(`\nLLM suggested ${suggestions.length} rule changes. Validating...`);

  // Validate
  const { accepted, rejected } = validateSuggestions(
    suggestions,
    rules,
    decisions,
    config.learning.confidence_threshold,
  );

  if (rejected.length > 0) {
    console.log(`\nRejected ${rejected.length} suggestions:`);
    for (const { suggestion, reason } of rejected) {
      console.log(`  \x1b[31m✗\x1b[0m ${suggestion.pattern} — ${reason}`);
    }
  }

  if (accepted.length === 0) {
    console.log("\nNo valid suggestions after validation. Try again after more sessions.");
    return;
  }

  // Write pending rules
  const pendingPath = join(getCcGuardDir(), "pending-rules.yaml");
  const pending = {
    generated_at: new Date().toISOString(),
    based_on: `${stats.total} decisions across ${stats.sessionCount} sessions`,
    suggestions: accepted.map((s) => ({
      action: s.action,
      pattern: s.pattern,
      reason: s.reason,
      confidence: s.confidence,
    })),
  };
  await Bun.write(pendingPath, stringify(pending));

  console.log(`\n\x1b[32m${accepted.length} validated suggestions saved.\x1b[0m`);
  console.log(`Run 'cc-guard diff' to review, 'cc-guard apply' to accept.`);
}
