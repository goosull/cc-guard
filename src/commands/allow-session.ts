import { addTempAllow } from "../temp-allows";

export async function cmdAllowSession(args: string[]): Promise<void> {
  const pattern = args[0];
  if (!pattern) {
    console.error("Usage: cc-guard allow-session <pattern>");
    process.exit(1);
  }
  addTempAllow(pattern, "session");
  console.log(`[cc-guard] Session allow added: "${pattern}" (expires in 24h)`);
}
