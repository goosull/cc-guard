# CLAUDE.md

Guide for AI coding assistants working on cc-guard.

## What is cc-guard?

A PreToolUse hook for Claude Code that provides regex-based permission management. Blocks dangerous commands (deny list), allows everything else (blacklist approach). Session logging enables LLM-powered rule learning.

## Commands

```bash
bun install          # Install dependencies
bun test             # Run all tests
bun run build        # Compile to single binary at dist/cc-guard
bun run src/cli.ts   # Run without compiling (dev mode)
```

## Architecture

```
src/cli.ts           → Subcommand routing
src/engine.ts        → Core: regex matching (deny → allow → default-allow)
src/rules.ts         → YAML rule loader with global + project merge
src/logger.ts        → JSONL session logger
src/validator.ts     → LLM suggestion validator (regex syntax, deny conflicts)
src/config.ts        → Config file loader (~/.cc-guard/config.yaml)
src/commands/        → One file per CLI command (check, init, status, log, import, learn, diff, apply)
rules/default.yaml   → Built-in deny rules
tests/engine.test.ts → 31 unit tests
```

## Key Conventions

- **Fail-open**: Every error path must `process.exit(0)`. A broken hook must never block Claude Code.
- **Deny > Allow > Default-allow**: This ordering is the core invariant. Never change it.
- **Compound command splitting**: Bash commands with `&&`, `||`, `;`, `|`, `\n` are split and each segment is checked independently. Full command is also checked unsplit (for patterns like `curl.*|.*bash`).
- **No runtime AI**: The `check` command is pure regex. Zero network calls. LLM is only used in `learn`.
- **YAML for rules**: `~/.cc-guard/rules.yaml` (global) + `~/.cc-guard/projects/{slug}.yaml` (per-project overlay).

## Testing

```bash
bun test                    # Run all tests
bun test tests/engine.test.ts  # Run specific test file
```

Tests cover: deny matching, allow matching, default-allow, compound commands, quote-aware splitting, edge cases (empty input, invalid regex, long commands), deny>allow priority.

## When modifying the engine

1. Every change to `engine.ts` must have a corresponding test in `tests/engine.test.ts`
2. After changes, verify: `bun test && bun run build`
3. Integration test: `echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"},"session_id":"t","cwd":"/","hook_event_name":"PreToolUse"}' | ./dist/cc-guard check; echo $?` should output `2`
