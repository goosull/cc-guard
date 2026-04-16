import { parse } from "yaml";
import { join } from "path";
import { getCcGuardDir } from "./rules";

export interface CcGuardConfig {
  llm: {
    provider: "claude" | "openai";
    model: string;
    api_key_env: string;
  };
  learning: {
    min_sessions: number;
    confidence_threshold: "low" | "medium" | "high";
  };
}

const defaults: CcGuardConfig = {
  llm: {
    provider: "claude",
    model: "claude-sonnet-4-6",
    api_key_env: "ANTHROPIC_API_KEY",
  },
  learning: {
    min_sessions: 0,
    confidence_threshold: "medium",
  },
};

export async function loadConfig(): Promise<CcGuardConfig> {
  const configPath = join(getCcGuardDir(), "config.yaml");
  try {
    const content = await Bun.file(configPath).text();
    const parsed = parse(content);
    if (!parsed || typeof parsed !== "object") return defaults;
    return {
      llm: {
        provider: parsed.llm?.provider ?? defaults.llm.provider,
        model: parsed.llm?.model ?? defaults.llm.model,
        api_key_env: parsed.llm?.api_key_env ?? defaults.llm.api_key_env,
      },
      learning: {
        min_sessions: parsed.learning?.min_sessions ?? defaults.learning.min_sessions,
        confidence_threshold: parsed.learning?.confidence_threshold ?? defaults.learning.confidence_threshold,
      },
    };
  } catch {
    return defaults;
  }
}
