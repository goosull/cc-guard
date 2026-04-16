import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { parse, stringify } from "yaml";
import { getCcGuardDir, loadRules, getDefaultRulesPath } from "../rules";

export async function cmdApply(): Promise<void> {
  const pendingPath = join(getCcGuardDir(), "pending-rules.yaml");

  if (!existsSync(pendingPath)) {
    console.log("No pending rules. Run 'cc-guard learn' first.");
    return;
  }

  const content = await Bun.file(pendingPath).text();
  const pending = parse(content);
  const rules = await loadRules();

  if (!pending.suggestions || pending.suggestions.length === 0) {
    console.log("No suggestions in pending file.");
    unlinkSync(pendingPath);
    return;
  }

  const existingDeny = new Set(rules.deny.map((r) => r.pattern));
  const existingAllow = new Set(rules.allow.map((r) => r.pattern));

  let added = 0;
  let removed = 0;
  let skipped = 0;

  for (const s of pending.suggestions) {
    if (s.action === "add_deny") {
      if (existingDeny.has(s.pattern)) {
        skipped++;
        continue;
      }
      rules.deny.push({
        pattern: s.pattern,
        reason: s.reason,
        source: "auto-learned",
        learned_at: new Date().toISOString().slice(0, 10),
      });
      console.log(`  \x1b[31m+deny\x1b[0m  ${s.pattern}`);
      added++;
    } else if (s.action === "add_allow") {
      if (existingAllow.has(s.pattern)) {
        skipped++;
        continue;
      }
      rules.allow.push({
        pattern: s.pattern,
        source: "auto-learned",
        learned_at: new Date().toISOString().slice(0, 10),
      });
      console.log(`  \x1b[32m+allow\x1b[0m ${s.pattern}`);
      added++;
    } else if (s.action === "remove_allow") {
      const idx = rules.allow.findIndex((r) => r.pattern === s.pattern);
      if (idx !== -1) {
        rules.allow.splice(idx, 1);
        console.log(`  \x1b[33m-allow\x1b[0m ${s.pattern}`);
        removed++;
      } else {
        skipped++;
      }
    }
  }

  // Write updated rules
  const rulesPath = getDefaultRulesPath();
  await Bun.write(rulesPath, stringify(rules));

  // Remove pending file
  unlinkSync(pendingPath);

  console.log(`\nApplied: ${added} added, ${removed} removed, ${skipped} skipped (already existed).`);
  console.log("Rules updated at", rulesPath);
}
