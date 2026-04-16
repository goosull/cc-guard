# Contributing to cc-guard

Thanks for your interest in contributing!

## Prerequisites

- [Bun](https://bun.sh/) v1.0+

## Setup

```bash
git clone https://github.com/goosull/cc-guard.git
cd cc-guard
bun install
```

## Development

```bash
# Run tests
bun test

# Build the binary
bun run build

# Run without building
bun run src/cli.ts status
```

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests for any new functionality
4. Run `bun test` — all tests must pass
5. Run `bun run build` — binary must compile
6. Update `CHANGELOG.md` if your change is user-facing
7. Open a PR

## Code style

- TypeScript, strict mode
- No external linter yet — follow existing patterns
- Prefer `Bun.file()` over `fs.readFileSync()` for new code
- Fail-open: hooks must never block Claude Code on error

## Architecture

```
src/
├── engine.ts       # Core regex matching (deny → allow → default)
├── rules.ts        # YAML config loader
├── logger.ts       # Session JSONL logger
├── validator.ts    # LLM suggestion validation
├── config.ts       # Config file loader
├── cli.ts          # Subcommand router
└── commands/       # One file per CLI command
```

## Adding a deny rule

Add to `rules/default.yaml`:

```yaml
deny:
  - pattern: "your regex here"
    reason: "Why this is dangerous"
```

Test it:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"your dangerous command"},"session_id":"test","cwd":"/tmp","hook_event_name":"PreToolUse"}' | bun run src/cli.ts check
# Should exit with code 2
```

## Questions?

Open an issue — we're happy to help.
