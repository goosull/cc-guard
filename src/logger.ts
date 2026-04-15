import { join } from "path";
import { appendFileSync, mkdirSync } from "fs";
import { getCcGuardDir } from "./rules";
import type { Decision } from "./types";

function getSessionLogPath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dir = join(getCcGuardDir(), "sessions");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // already exists
  }
  return join(dir, `${date}.jsonl`);
}

export function logDecision(decision: Decision): void {
  try {
    const path = getSessionLogPath();
    appendFileSync(path, JSON.stringify(decision) + "\n");
  } catch {
    // Silent failure — logging must never affect the decision
  }
}
