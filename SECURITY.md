# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in cc-guard, please report it responsibly:

1. **Do NOT open a public issue**
2. Use [GitHub's private vulnerability reporting](https://github.com/goosull/cc-guard/security/advisories/new)
3. Or email: goosull@users.noreply.github.com

I'll respond within 48 hours and work with you on a fix.

## Security Model

cc-guard is a permission guard, so its own security matters:

- **Fail-open**: If cc-guard crashes or can't read rules, it exits 0 (allow). A broken guard never blocks your work.
- **Regex only at runtime**: No network calls, no AI/LLM calls, no external dependencies during `check`. Pure regex matching.
- **Deny beats allow**: A command matching any deny rule is blocked regardless of allow rules.
- **Input normalization**: Whitespace trimming, newline stripping, and compound command splitting reduce evasion vectors.
- **LLM calls only in `learn`**: The learning engine calls an LLM API, but only when you explicitly run `cc-guard learn`. Never during hook execution.

## Known Limitations

- Regex patterns don't prevent all evasion (e.g., shell variable expansion: `$CMD` where CMD=`rm -rf /`)
- Subshell expressions `$()` and backticks are not yet decomposed
- Unicode homoglyph attacks are not normalized

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes       |
| < 0.2   | No        |
