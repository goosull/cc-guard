#!/usr/bin/env node

const { execFileSync } = require("child_process");
const { join } = require("path");

const cliPath = join(__dirname, "..", "src", "cli.ts");

// Try bun first (required runtime), fall back to error message
try {
  execFileSync("bun", ["run", cliPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });
} catch (err) {
  if (err.status != null) {
    process.exit(err.status);
  }
  console.error(
    "[cc-guard] Bun runtime is required but not found.\n" +
    "Install Bun: curl -fsSL https://bun.sh/install | bash\n" +
    "Then retry: cc-guard " + process.argv.slice(2).join(" ")
  );
  process.exit(1);
}
