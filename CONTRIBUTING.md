# Contributing to cc-guard

Thanks for your interest in contributing!

## Prerequisites

- [Bun](https://bun.sh/) v1.0+
- [Claude Code](https://code.claude.com/) (for testing hooks integration)

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

## Workflow

We use a **PR-based workflow**. The `main` branch is protected — all changes go through pull requests.

```
1. Fork the repo (or create a branch if you have write access)
2. Create a feature branch: git checkout -b feat/my-feature
3. Make your changes
4. Add or update tests
5. Run: bun test && bun run build
6. Update CHANGELOG.md if user-facing
7. Push and open a PR against main
8. CI runs automatically (test + build must pass)
9. Merge after CI passes
```

### Branch naming

- `feat/description` — new features
- `fix/description` — bug fixes
- `docs/description` — documentation changes
- `chore/description` — maintenance, CI, deps

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new deny rule for SQL injection
fix: handle escaped quotes in compound commands
docs: update README with auto-learn docs
chore: update CI workflow
```

### Releases

Releases are automated via GitHub Actions:

1. Update `CHANGELOG.md` and bump version in `package.json`
2. Merge the PR to `main`
3. Tag the merge commit: `git tag v0.X.0 && git push origin v0.X.0`
4. GitHub Actions builds cross-platform binaries and creates a GitHub Release

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
