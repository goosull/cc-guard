import { clearTempAllows } from "../temp-allows";

export async function cmdAllowClear(): Promise<void> {
  const count = clearTempAllows();
  console.log(`[cc-guard] Cleared ${count} temp-allow(s)`);
}
