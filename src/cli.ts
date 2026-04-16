import { cmdCheck } from "./commands/check";
import { cmdInit } from "./commands/init";
import { cmdStatus } from "./commands/status";
import { cmdLog } from "./commands/log";
import { cmdImport } from "./commands/import";
import { cmdLearn } from "./commands/learn";
import { cmdDiff } from "./commands/diff";
import { cmdApply } from "./commands/apply";

const [cmd, ...args] = process.argv.slice(2);

const commands: Record<string, (args: string[]) => Promise<void>> = {
  check: () => cmdCheck(),
  init: () => cmdInit(),
  status: () => cmdStatus(),
  log: (a) => cmdLog(a),
  import: (a) => cmdImport(a),
  learn: (a) => cmdLearn(a),
  diff: () => cmdDiff(),
  apply: () => cmdApply(),
};

if (!cmd || cmd === "help" || cmd === "--help") {
  console.log(`cc-guard — Adaptive permission hook for Claude Code

Usage: cc-guard <command>

Commands:
  init      Initialize ~/.cc-guard/ and register hook in settings.json
  check     PreToolUse hook entry point (reads from stdin)
  status    Show current rules count and session statistics
  log [N]   Show last N decisions (default: 20)
  import [path]  Import rules from settings.local.json
  learn     Analyze session logs with LLM and suggest rule changes
  diff      Preview pending rule changes from learn
  apply     Apply pending rule changes to rules.yaml
  help      Show this help message

Examples:
  cc-guard init                          # First-time setup
  cc-guard status                        # Check configuration
  cc-guard import .claude/settings.local.json  # Migrate existing rules
  cc-guard log 50                        # Show last 50 decisions
  cc-guard learn                         # LLM-powered rule suggestions
  cc-guard diff                          # Review suggestions
  cc-guard apply                         # Accept suggestions`);
  process.exit(0);
}

const handler = commands[cmd];
if (!handler) {
  console.error(`Unknown command: ${cmd}\nRun 'cc-guard help' for usage.`);
  process.exit(1);
}

handler(args).catch((err) => {
  console.error(`[cc-guard] Error: ${err.message}`);
  process.exit(1);
});
