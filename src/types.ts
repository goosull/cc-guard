export interface Rule {
  pattern: string;
  reason?: string;
  tools?: string[];
  source?: "manual" | "auto-learned" | "project-context" | "imported";
  learned_at?: string;
}

export interface RulesConfig {
  version: number;
  deny: Rule[];
  allow: Rule[];
}

export interface HookInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd: string;
  hook_event_name: string;
}

export type DecisionType = "deny" | "allow" | "default-allow";

export interface EngineResult {
  decision: DecisionType;
  reason?: string;
  matched_pattern?: string;
}

export interface Decision {
  ts: string;
  tool: string;
  input: string;
  decision: DecisionType;
  source: "rule" | "default";
  matched_pattern?: string;
  reason?: string;
}
