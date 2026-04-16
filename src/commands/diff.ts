import { existsSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { getCcGuardDir, loadRules } from "../rules";

interface PendingRules {
  generated_at: string;
  based_on: string;
  suggestions: Array<{
    action: "add_allow" | "add_deny" | "remove_allow";
    pattern: string;
    reason: string;
    confidence: string;
  }>;
}

export async function cmdDiff(): Promise<void> {
  const pendingPath = join(getCcGuardDir(), "pending-rules.yaml");

  if (!existsSync(pendingPath)) {
    console.log("No pending rules. Run 'cc-guard learn' first.");
    return;
  }

  const content = await Bun.file(pendingPath).text();
  const pending: PendingRules = parse(content);
  const rules = await loadRules();

  console.log(`Pending rule changes (generated ${pending.generated_at})`);
  console.log(`Based on: ${pending.based_on}`);
  console.log(`${"─".repeat(60)}`);

  if (!pending.suggestions || pending.suggestions.length === 0) {
    console.log("No suggestions in pending file.");
    return;
  }

  const existingDeny = new Set(rules.deny.map((r) => r.pattern));
  const existingAllow = new Set(rules.allow.map((r) => r.pattern));

  for (const s of pending.suggestions) {
    const exists =
      (s.action === "add_deny" && existingDeny.has(s.pattern)) ||
      (s.action === "add_allow" && existingAllow.has(s.pattern));

    const icon = exists
      ? "\x1b[90m≡\x1b[0m" // gray: already exists
      : s.action === "add_deny"
        ? "\x1b[31m+deny\x1b[0m"
        : s.action === "add_allow"
          ? "\x1b[32m+allow\x1b[0m"
          : "\x1b[33m-allow\x1b[0m";

    const confidence = s.confidence === "high"
      ? "\x1b[32m●\x1b[0m"
      : s.confidence === "medium"
        ? "\x1b[33m●\x1b[0m"
        : "\x1b[31m●\x1b[0m";

    const status = exists ? " (already exists)" : "";
    console.log(`  ${icon} ${confidence} ${s.pattern}${status}`);
    console.log(`      ${s.reason}`);
  }

  const actionable = pending.suggestions.filter((s) => {
    if (s.action === "add_deny") return !existingDeny.has(s.pattern);
    if (s.action === "add_allow") return !existingAllow.has(s.pattern);
    return true;
  });

  console.log(`\n${actionable.length} new rules to apply. Run 'cc-guard apply' to accept.`);
}
