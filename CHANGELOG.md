# Changelog

All notable changes to cc-guard are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.3.0] - 2026-04-16

### Added
- Always-on auto-learning — `SessionEnd` hook triggers `cc-guard learn --auto` after every session
- Claude CLI as primary LLM backend — uses your existing Claude Code login, no API key needed
- Anthropic SDK as fallback if Claude CLI is unavailable

### Changed
- Removed `min_sessions` gate — learning starts from the very first session
- PR-based workflow — `main` branch is protected, all changes go through pull requests
- Updated CONTRIBUTING.md with PR workflow, branch naming, and conventional commits
- `cc-guard init` now registers both PreToolUse and SessionEnd hooks

## [0.2.0] - 2026-04-16

### Added
- LLM-powered rule learning — `cc-guard learn` analyzes session logs and suggests rule changes
- Rule validation with regex syntax checking, deny conflict detection, and back-testing
- Pending rules workflow — `cc-guard diff` to preview, `cc-guard apply` to accept
- Configuration file (`~/.cc-guard/config.yaml`) for LLM provider and learning thresholds
- GitHub Actions CI — tests and build verification on every push/PR
- Automated release workflow — tag push builds cross-platform binaries
- Issue and PR templates
- CONTRIBUTING.md, SECURITY.md, CLAUDE.md

## [0.1.0] - 2026-04-15

### Added
- Regex-based deny/allow engine with compound command splitting
- PreToolUse hook integration with Claude Code
- Session decision logging (JSONL)
- CLI commands: `init`, `check`, `status`, `log`, `import`
- Default deny rules: rm -rf, force push, hard reset, sudo, chmod 777, curl|bash
- Quote-aware compound command splitting (&&, ||, ;, |, newlines)
- Input normalization (whitespace, newlines)
- Rule migration from `settings.local.json` with pattern generalization
- 31 unit tests covering deny, allow, compound commands, and edge cases
