import { getActiveTempAllows } from "../temp-allows";

export async function cmdAllows(): Promise<void> {
  const allows = getActiveTempAllows();

  if (allows.length === 0) {
    console.log("No active temporary allows.");
    return;
  }

  console.log(`Active temporary allows (${allows.length}):\n`);

  for (const a of allows) {
    const remaining =
      a.type === "once" ? `${a.uses_remaining ?? 0} use(s)` : "unlimited";
    const expires = a.expires_at.slice(0, 19).replace("T", " ");
    console.log(`  ${a.type.padEnd(7)} | ${remaining.padEnd(12)} | expires ${expires} | ${a.pattern}`);
  }
}
