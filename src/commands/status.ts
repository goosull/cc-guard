import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { getCcGuardDir, loadRules } from "../rules";

export async function cmdStatus(): Promise<void> {
  const rules = await loadRules();
  const sessionsDir = join(getCcGuardDir(), "sessions");

  let sessionFiles: string[] = [];
  try {
    sessionFiles = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    // No sessions dir
  }

  // Count today's decisions
  const today = new Date().toISOString().slice(0, 10);
  const todayFile = join(sessionsDir, `${today}.jsonl`);
  let todayDecisions = 0;
  let todayDeny = 0;
  try {
    const lines = readFileSync(todayFile, "utf-8").trim().split("\n").filter(Boolean);
    todayDecisions = lines.length;
    todayDeny = lines.filter((l) => {
      try { return JSON.parse(l).decision === "deny"; } catch { return false; }
    }).length;
  } catch {
    // No today's log
  }

  console.log("cc-guard status");
  console.log("===============");
  console.log(`Deny rules:    ${rules.deny.length}`);
  console.log(`Allow rules:   ${rules.allow.length}`);
  console.log(`Session files: ${sessionFiles.length}`);
  console.log(`Today:         ${todayDecisions} decisions (${todayDeny} denied)`);
}
