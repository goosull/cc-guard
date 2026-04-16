import { join } from "path";
import { readFileSync, writeFileSync, renameSync, unlinkSync } from "fs";
import { getCcGuardDir } from "./rules";

export interface TempAllow {
  pattern: string;
  type: "once" | "session";
  uses_remaining?: number;
  created_at: string;
  expires_at: string;
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getTempAllowsPath(): string {
  return join(getCcGuardDir(), "temp-allows.json");
}

export function loadTempAllows(): TempAllow[] {
  try {
    const content = readFileSync(getTempAllowsPath(), "utf-8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTempAllows(allows: TempAllow[]): void {
  const path = getTempAllowsPath();
  const tmpPath = path + ".tmp";
  try {
    writeFileSync(tmpPath, JSON.stringify(allows, null, 2) + "\n");
    renameSync(tmpPath, path);
  } catch {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore cleanup failure
    }
  }
}

export function getActiveTempAllows(): TempAllow[] {
  const now = new Date().toISOString();
  return loadTempAllows().filter((a) => a.expires_at > now);
}

export function addTempAllow(pattern: string, type: "once" | "session"): void {
  const allows = getActiveTempAllows();
  const existing = allows.find((a) => a.pattern === pattern && a.type === type);

  if (existing) {
    if (type === "once") {
      existing.uses_remaining = (existing.uses_remaining ?? 0) + 1;
    }
    // Refresh TTL for both types
    existing.expires_at = new Date(new Date().getTime() + TTL_MS).toISOString();
  } else {
    const now = new Date();
    const entry: TempAllow = {
      pattern,
      type,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
    };
    if (type === "once") {
      entry.uses_remaining = 1;
    }
    allows.push(entry);
  }

  saveTempAllows(allows);
}

export function removeTempAllow(pattern: string): boolean {
  const allows = getActiveTempAllows();
  const idx = allows.findIndex((a) => a.pattern === pattern);
  if (idx === -1) return false;
  allows.splice(idx, 1);
  saveTempAllows(allows);
  return true;
}

export function clearTempAllows(): number {
  const allows = loadTempAllows();
  const count = allows.length;
  saveTempAllows([]);
  return count;
}

/**
 * Check if a denied pattern has an active temp-allow WITHOUT consuming it.
 * Used for dry-run checks before committing to consumption.
 */
export function hasTempAllow(deniedPattern: string): boolean {
  const now = new Date().toISOString();
  const allows = loadTempAllows().filter((a) => a.expires_at > now);
  return allows.some((a) => a.pattern === deniedPattern);
}

/**
 * Consume a temp-allow for a denied pattern.
 * Uses exact string equality on the pattern field.
 * For "once" type: decrements uses_remaining, removes if depleted.
 * For "session" type: no decrement (TTL-only expiry).
 * Returns true if temp-allow consumed, false if not found.
 */
export function consumeTempAllow(deniedPattern: string): boolean {
  const now = new Date().toISOString();
  const allows = loadTempAllows().filter((a) => a.expires_at > now);

  const idx = allows.findIndex((a) => a.pattern === deniedPattern);
  if (idx === -1) {
    return false;
  }

  const entry = allows[idx];

  if (entry.type === "once") {
    entry.uses_remaining = (entry.uses_remaining ?? 1) - 1;
    if (entry.uses_remaining <= 0) {
      allows.splice(idx, 1);
    }
  }
  // session type: no decrement, just match

  saveTempAllows(allows);
  return true;
}
