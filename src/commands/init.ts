import { join } from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { homedir } from "os";
import { getCcGuardDir } from "../rules";

export async function cmdInit(): Promise<void> {
  const ccGuardDir = getCcGuardDir();
  const settingsPath = join(homedir(), ".claude", "settings.json");

  // 1. Create directory structure
  const dirs = [
    ccGuardDir,
    join(ccGuardDir, "sessions"),
    join(ccGuardDir, "projects"),
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
  console.log(`Created ${ccGuardDir}/`);

  // 2. Copy default rules if not exists
  const rulesPath = join(ccGuardDir, "rules.yaml");
  if (!existsSync(rulesPath)) {
    // Find default.yaml relative to this script
    const defaultYaml = join(import.meta.dir, "..", "..", "rules", "default.yaml");
    if (existsSync(defaultYaml)) {
      copyFileSync(defaultYaml, rulesPath);
      console.log(`Copied default rules to ${rulesPath}`);
    } else {
      // Inline default rules if bundled binary can't find the file
      const { stringify } = await import("yaml");
      const defaultRules = {
        version: 1,
        deny: [
          { pattern: "^rm -rf ", reason: "Recursive force delete" },
          { pattern: "^rm -r /", reason: "Recursive delete from root" },
          { pattern: "git push --force", reason: "Force push" },
          { pattern: "git push .* --force", reason: "Force push (flag after remote)" },
          { pattern: "git reset --hard", reason: "Hard reset" },
          { pattern: "^sudo ", reason: "Elevated privileges" },
          { pattern: "^chmod 777", reason: "World-writable permissions" },
          { pattern: "curl .* \\| .*(bash|sh|zsh)", reason: "Download and execute" },
          { pattern: "wget .* -O- \\| .*(bash|sh|zsh)", reason: "Download and execute" },
        ],
        allow: [],
      };
      writeFileSync(rulesPath, stringify(defaultRules));
      console.log(`Created default rules at ${rulesPath}`);
    }
  } else {
    console.log(`Rules already exist at ${rulesPath}`);
  }

  // 3. Create config.yaml if not exists
  const configPath = join(ccGuardDir, "config.yaml");
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      `# cc-guard configuration
# LLM is used only for "cc-guard learn" — never at runtime.
# Primary: Claude CLI (uses your existing Claude Code login, no API key needed)
# Fallback: Anthropic SDK (requires ANTHROPIC_API_KEY env var)
llm:
  provider: "claude"
  model: "claude-sonnet-4-6"
  api_key_env: "ANTHROPIC_API_KEY"

learning:
  min_sessions: 0
  confidence_threshold: "medium"

hooks:
  tool_scope: "Bash"
`
    );
    console.log(`Created config at ${configPath}`);
  }

  // 4. Register hook in settings.json
  registerHook(settingsPath);

  console.log("\ncc-guard initialized! Run 'cc-guard status' to verify.");
}

function registerHook(settingsPath: string): void {
  let settings: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      console.error(`Warning: Could not parse ${settingsPath}`);
      return;
    }
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const preToolUse = (hooks.PreToolUse ?? []) as Array<{
    matcher?: string;
    hooks?: Array<{ type?: string; command?: string }>;
  }>;

  // Check if PreToolUse already registered
  const preToolRegistered = preToolUse.some((entry) =>
    entry.hooks?.some((h) => h.command?.includes("cc-guard"))
  );

  if (!preToolRegistered) {
    preToolUse.push({
      matcher: "Bash",
      hooks: [
        {
          type: "command",
          command: "cc-guard check",
        },
      ],
    });
    hooks.PreToolUse = preToolUse;
    console.log("Registered PreToolUse hook");
  } else {
    console.log("PreToolUse hook already registered");
  }

  // Register SessionEnd hook for auto-learning
  const sessionEnd = (hooks.SessionEnd ?? []) as Array<{
    hooks?: Array<{ type?: string; command?: string }>;
  }>;

  const sessionEndRegistered = sessionEnd.some((entry) =>
    entry.hooks?.some((h) => h.command?.includes("cc-guard"))
  );

  if (!sessionEndRegistered) {
    sessionEnd.push({
      hooks: [
        {
          type: "command",
          command: "cc-guard learn --auto",
        },
      ],
    });
    hooks.SessionEnd = sessionEnd;
    console.log("Registered SessionEnd hook (auto-learn)");
  } else {
    console.log("SessionEnd hook already registered");
  }

  settings.hooks = hooks;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log(`Updated ${settingsPath}`);
}
