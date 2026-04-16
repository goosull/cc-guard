import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { stringify } from "yaml";
import { getCcGuardDir, loadRules } from "../rules";
import { loadConfig } from "../config";
import { validateSuggestions, type RuleSuggestion } from "../validator";
import type { Decision } from "../types";

export function loadAllDecisions(): Decision[] {
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

export function buildStats(decisions: Decision[]) {
  const allowed = decisions.filter((d) => d.decision === "allow" || d.decision === "default-allow");
  const denied = decisions.filter((d) => d.decision === "deny");
  const defaultAllowed = decisions.filter((d) => d.decision === "default-allow");

  const prefixCounts = new Map<string, number>();
  for (const d of defaultAllowed) {
    const prefix = d.input.split(/\s+/)[0] ?? "unknown";
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
  }

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

/**
 * Strategic sampling: instead of just taking the first 100 decisions,
 * sample across time periods with frequency-weighted representation.
 *
 * Strategy:
 * 1. All denied decisions (always interesting, usually few)
 * 2. Time-stratified sample of default-allowed decisions (most interesting for new rules)
 * 3. Fill remaining budget with allowed decisions for context
 *
 * @param maxSample - maximum number of decisions to include (default 200)
 */
export function sampleDecisions(decisions: Decision[], maxSample: number = 200): Decision[] {
  if (decisions.length <= maxSample) return decisions;

  const denied = decisions.filter(d => d.decision === "deny");
  const defaultAllowed = decisions.filter(d => d.decision === "default-allow");
  const allowed = decisions.filter(d => d.decision === "allow");

  const result: Decision[] = [];

  // 1. All denied decisions (cap at 30% of budget)
  const deniedBudget = Math.min(denied.length, Math.floor(maxSample * 0.3));
  result.push(...denied.slice(0, deniedBudget));

  // 2. Time-stratified default-allowed (50% of budget)
  const defaultBudget = Math.min(defaultAllowed.length, Math.floor(maxSample * 0.5));
  if (defaultAllowed.length > 0 && defaultBudget > 0) {
    result.push(...stratifiedSample(defaultAllowed, defaultBudget));
  }

  // 3. Fill remaining with allowed decisions
  const remaining = maxSample - result.length;
  if (remaining > 0 && allowed.length > 0) {
    result.push(...stratifiedSample(allowed, Math.min(remaining, allowed.length)));
  }

  return result;
}

/**
 * Take a time-stratified sample: divide decisions into time buckets
 * and sample equally from each bucket, ensuring even temporal coverage.
 */
function stratifiedSample(decisions: Decision[], count: number): Decision[] {
  if (decisions.length <= count) return decisions;

  // Group by date
  const byDate = new Map<string, Decision[]>();
  for (const d of decisions) {
    const date = d.ts.slice(0, 10);
    const group = byDate.get(date) ?? [];
    group.push(d);
    byDate.set(date, group);
  }

  const dates = [...byDate.keys()].sort();
  const perBucket = Math.max(1, Math.floor(count / dates.length));
  const result: Decision[] = [];

  for (const date of dates) {
    const bucket = byDate.get(date)!;
    // Take evenly spaced items from each bucket
    const take = Math.min(perBucket, bucket.length);
    const step = bucket.length / take;
    for (let i = 0; i < take && result.length < count; i++) {
      result.push(bucket[Math.floor(i * step)]);
    }
  }

  // If we still have room (uneven distribution), fill from largest buckets
  if (result.length < count) {
    const seen = new Set(result);
    for (const date of dates) {
      for (const d of byDate.get(date)!) {
        if (result.length >= count) break;
        if (!seen.has(d)) {
          result.push(d);
          seen.add(d);
        }
      }
    }
  }

  return result;
}

export function buildPrompt(decisions: Decision[], currentRulesYaml: string, stats: ReturnType<typeof buildStats>, fullMode: boolean = false): string {
  const sample = fullMode ? decisions : sampleDecisions(decisions);

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

## Decisions (${sample.length} of ${stats.total}, stratified by time + decision type)
${sample.map((d) => `${d.decision.padEnd(14)} | ${d.source.padEnd(7)} | ${d.tool}: ${d.input.slice(0, 100)}`).join("\n")}

## Your Task

Analyze these patterns and suggest rule changes. For each suggestion:
1. The regex pattern
2. Whether to add it as "allow" or "deny"
3. Your reasoning
4. Confidence level (high/medium/low)

Guidelines:
- Commands that appear 2+ times as "default-allow" are candidates for explicit allow rules
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

export function parseLlmResponse(text: string): RuleSuggestion[] {
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

/**
 * Call LLM via Claude CLI (uses existing Claude Code login — no API key needed).
 * Falls back to Anthropic SDK if claude CLI is not available.
 */
async function callLlm(prompt: string): Promise<string> {
  // Try Claude CLI first (zero-config, uses existing OAuth login)
  try {
    const proc = Bun.spawn(["claude", "-p", prompt, "--output-format", "text"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0 && stdout.trim().length > 0) {
      return stdout;
    }
  } catch {
    // Claude CLI not available — fall through to SDK
  }

  // Fallback: Anthropic SDK (requires ANTHROPIC_API_KEY)
  const config = await loadConfig();
  const apiKey = process.env[config.llm.api_key_env];
  if (!apiKey) {
    console.error("Claude CLI not available and no API key set.");
    console.error("Either install Claude Code CLI or set ANTHROPIC_API_KEY.");
    process.exit(1);
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: config.llm.model,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });
  return response.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export async function cmdLearn(args: string[] = []): Promise<void> {
  const isAuto = args.includes("--auto");
  const fullMode = args.includes("--full");
  const config = await loadConfig();
  const rules = await loadRules();
  const decisions = loadAllDecisions();

  if (decisions.length === 0) {
    if (!isAuto) console.log("No session data yet. Use Claude Code for a while and try again.");
    return;
  }

  const stats = buildStats(decisions);

  if (!isAuto) {
    console.log(`Analyzing ${stats.total} decisions across ${stats.sessionCount} sessions...`);
    console.log(`  Allowed: ${stats.allowed} | Denied: ${stats.denied} | Default: ${stats.defaultAllowed}`);
  }

  // No minimum session gate — learn from any amount of data
  if (stats.defaultAllowed === 0 && stats.denied === 0) {
    if (!isAuto) console.log("No unmatched or denied commands to learn from.");
    return;
  }

  const rulesYaml = stringify(rules);
  const prompt = buildPrompt(decisions, rulesYaml, stats, fullMode);

  if (!isAuto && fullMode) {
    console.log(`  Full mode: including all ${decisions.length} decisions in prompt`);
  } else if (!isAuto) {
    const sampleSize = Math.min(decisions.length, 200);
    console.log(`  Sampling: ${sampleSize} of ${decisions.length} decisions (use --full for all)`);
  }

  if (!isAuto) console.log("\nCalling LLM for analysis...");

  let responseText: string;
  try {
    responseText = await callLlm(prompt);
  } catch (e) {
    if (!isAuto) console.error(`LLM error: ${(e as Error).message}`);
    return; // Don't exit(1) in auto mode — silent failure
  }

  const suggestions = parseLlmResponse(responseText);
  if (suggestions.length === 0) {
    if (!isAuto) console.log("\nLLM returned no suggestions. Your rules look good as-is.");
    return;
  }

  if (!isAuto) console.log(`\nLLM suggested ${suggestions.length} rule changes. Validating...`);

  const { accepted, rejected } = validateSuggestions(
    suggestions,
    rules,
    decisions,
    config.learning.confidence_threshold,
  );

  if (!isAuto && rejected.length > 0) {
    console.log(`\nRejected ${rejected.length} suggestions:`);
    for (const { suggestion, reason } of rejected) {
      console.log(`  \x1b[31m✗\x1b[0m ${suggestion.pattern} — ${reason}`);
    }
  }

  if (accepted.length === 0) {
    if (!isAuto) console.log("\nNo valid suggestions after validation.");
    return;
  }

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

  if (isAuto) {
    // In auto mode, just silently save. User sees it next session via status.
    console.log(`[cc-guard] ${accepted.length} rule suggestions saved. Run 'cc-guard diff' to review.`);
  } else {
    console.log(`\n\x1b[32m${accepted.length} validated suggestions saved.\x1b[0m`);
    console.log(`Run 'cc-guard diff' to review, 'cc-guard apply' to accept.`);
  }
}
