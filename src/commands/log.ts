import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { getCcGuardDir } from "../rules";
import type { Decision } from "../types";

export async function cmdLog(args: string[]): Promise<void> {
  const sessionsDir = join(getCcGuardDir(), "sessions");
  const limit = parseInt(args[0] ?? "20", 10);

  let files: string[] = [];
  try {
    files = readdirSync(sessionsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse();
  } catch {
    console.log("No session logs found.");
    return;
  }

  if (files.length === 0) {
    console.log("No session logs found.");
    return;
  }

  const decisions: Decision[] = [];

  for (const file of files) {
    if (decisions.length >= limit) break;
    try {
      const lines = readFileSync(join(sessionsDir, file), "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const line of lines.reverse()) {
        if (decisions.length >= limit) break;
        decisions.push(JSON.parse(line));
      }
    } catch {
      continue;
    }
  }

  if (decisions.length === 0) {
    console.log("No decisions logged yet.");
    return;
  }

  console.log(`Recent decisions (last ${decisions.length}):\n`);

  for (const d of decisions) {
    const time = d.ts.slice(11, 19);
    const icon = d.decision === "deny" ? "\x1b[31mDENY\x1b[0m" : d.decision === "allow" ? "\x1b[32mALLOW\x1b[0m" : "\x1b[90mPASS\x1b[0m";
    const input = d.input.length > 60 ? d.input.slice(0, 57) + "..." : d.input;
    console.log(`${time} [${icon}] ${d.tool}: ${input}`);
  }
}
