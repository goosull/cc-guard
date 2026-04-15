import { parse } from "yaml";
import { join } from "path";
import { homedir } from "os";
import type { RulesConfig } from "./types";

const CC_GUARD_DIR = join(homedir(), ".cc-guard");

function emptyRules(): RulesConfig {
  return { version: 1, deny: [], allow: [] };
}

function parseRulesFile(content: string): RulesConfig {
  const parsed = parse(content);
  if (!parsed || typeof parsed !== "object") return emptyRules();
  return {
    version: parsed.version ?? 1,
    deny: Array.isArray(parsed.deny) ? parsed.deny : [],
    allow: Array.isArray(parsed.allow) ? parsed.allow : [],
  };
}

export async function loadRules(projectSlug?: string): Promise<RulesConfig> {
  // Load global rules
  const globalPath = join(CC_GUARD_DIR, "rules.yaml");
  let global = emptyRules();
  try {
    const content = await Bun.file(globalPath).text();
    global = parseRulesFile(content);
  } catch {
    // No global rules file — use defaults
  }

  // Load project overlay if available
  if (projectSlug) {
    const projectPath = join(CC_GUARD_DIR, "projects", `${projectSlug}.yaml`);
    try {
      const content = await Bun.file(projectPath).text();
      const project = parseRulesFile(content);
      // Merge: deny = union, allow = concat. Project cannot remove global deny.
      global.deny = [...global.deny, ...project.deny];
      global.allow = [...global.allow, ...project.allow];
    } catch {
      // No project rules — use global only
    }
  }

  return global;
}

export function getDefaultRulesPath(): string {
  return join(CC_GUARD_DIR, "rules.yaml");
}

export function getCcGuardDir(): string {
  return CC_GUARD_DIR;
}
