import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { stringify } from "yaml";
import { getCcGuardDir, loadRules, getDefaultRulesPath } from "../rules";
import type { Rule } from "../types";

interface ImportResult {
  added: Rule[];
  skipped: string[];
}

/**
 * Parse a settings.local.json allow entry like "Bash(git fetch origin develop)"
 * and extract the tool name and command pattern.
 */
function parseAllowEntry(entry: string): { tool: string; command: string } | null {
  // Match patterns like "Bash(git fetch origin develop)" or "Bash(git *)"
  const match = entry.match(/^(\w+)\((.+)\)$/);
  if (!match) return null;
  return { tool: match[1], command: match[2] };
}

/**
 * Generalize a specific command into a broader regex pattern.
 * Groups commands by their first word(s).
 */
function generalizePattern(command: string): string {
  // Remove trailing wildcards/colons (e.g., "git status:*" → "git status")
  const clean = command.replace(/:?\*$/, "").trim();

  // Split into words
  const words = clean.split(/\s+/);
  if (words.length === 0) return `^${clean}`;

  // Use first 1-2 words as the pattern base
  if (words.length === 1) {
    return `^${escapeRegex(words[0])}(\\s|$)`;
  }

  // For commands like "git fetch origin develop", generalize to "^git fetch "
  return `^${escapeRegex(words[0])} ${escapeRegex(words[1])} `;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function cmdImport(args: string[]): Promise<void> {
  // Find settings.local.json
  const searchPaths = [
    args[0],
    join(process.cwd(), ".claude", "settings.local.json"),
    // Search upward from cwd for .claude/settings.local.json
    join(process.env.CLAUDE_PROJECT_DIR ?? "", ".claude", "settings.local.json"),
  ].filter(Boolean) as string[];

  let settingsPath: string | null = null;
  for (const p of searchPaths) {
    if (existsSync(p)) {
      settingsPath = p;
      break;
    }
  }

  if (!settingsPath) {
    console.error("Could not find settings.local.json. Pass the path as an argument.");
    process.exit(1);
  }

  console.log(`Importing from: ${settingsPath}`);

  const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  const allowEntries: string[] = settings.permissions?.allow ?? [];

  if (allowEntries.length === 0) {
    console.log("No allow entries found in settings.local.json");
    return;
  }

  console.log(`Found ${allowEntries.length} allow entries`);

  // Parse and group by generalized pattern
  const patternMap = new Map<string, Set<string>>();
  const skipped: string[] = [];

  for (const entry of allowEntries) {
    const parsed = parseAllowEntry(entry);
    if (!parsed || parsed.tool !== "Bash") {
      skipped.push(entry);
      continue;
    }

    const pattern = generalizePattern(parsed.command);
    if (!patternMap.has(pattern)) {
      patternMap.set(pattern, new Set());
    }
    patternMap.get(pattern)!.add(entry);
  }

  // Build allow rules
  const newRules: Rule[] = [];
  for (const [pattern, originals] of patternMap) {
    newRules.push({
      pattern,
      source: "imported",
      reason: `Imported from ${originals.size} settings.local.json entries`,
    });
  }

  // Load existing rules and merge
  const existing = await loadRules();
  const existingPatterns = new Set(existing.allow.map((r) => r.pattern));
  const added = newRules.filter((r) => !existingPatterns.has(r.pattern));

  if (added.length === 0) {
    console.log("All patterns already exist in rules.yaml");
    return;
  }

  existing.allow = [...existing.allow, ...added];

  // Write updated rules
  const rulesPath = getDefaultRulesPath();
  const yamlContent = stringify(existing);
  await Bun.write(rulesPath, yamlContent);

  console.log(`\nImport results:`);
  console.log(`  ${allowEntries.length} entries → ${added.length} generalized patterns`);
  console.log(`  Skipped: ${skipped.length} non-Bash entries`);
  console.log(`\nNew patterns added:`);
  for (const rule of added) {
    console.log(`  + ${rule.pattern}`);
  }

  if (skipped.length > 0) {
    // Write import log
    const logPath = join(getCcGuardDir(), "import.log");
    await Bun.write(logPath, skipped.join("\n") + "\n");
    console.log(`\nSkipped entries logged to ${logPath}`);
  }
}
