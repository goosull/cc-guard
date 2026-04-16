import { removeTempAllow } from "../temp-allows";

export async function cmdRevoke(args: string[]): Promise<void> {
  const pattern = args[0];
  if (!pattern) {
    console.error("Usage: cc-guard revoke <pattern>");
    process.exit(1);
  }
  const removed = removeTempAllow(pattern);
  if (removed) {
    console.log(`[cc-guard] Removed temp-allow: "${pattern}"`);
  } else {
    console.log(`[cc-guard] No matching temp-allow found for "${pattern}"`);
  }
}
