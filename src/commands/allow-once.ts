import { addTempAllow } from "../temp-allows";

export async function cmdAllowOnce(args: string[]): Promise<void> {
  const pattern = args[0];
  if (!pattern) {
    console.error("Usage: cc-guard allow-once <pattern>");
    process.exit(1);
  }
  addTempAllow(pattern, "once");
  console.log(`[cc-guard] Temporary allow added: "${pattern}" (1 use, expires in 24h)`);
}
