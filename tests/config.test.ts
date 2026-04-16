import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "../src/config";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `cc-guard-test-config-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  process.env.CC_GUARD_DIR = testDir;
});

afterEach(() => {
  delete process.env.CC_GUARD_DIR;
  rmSync(testDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns defaults when config file missing", async () => {
    const config = await loadConfig();
    expect(config.llm.provider).toBe("claude");
    expect(config.llm.model).toBe("claude-sonnet-4-6");
    expect(config.llm.api_key_env).toBe("ANTHROPIC_API_KEY");
    expect(config.learning.min_sessions).toBe(0);
    expect(config.learning.confidence_threshold).toBe("medium");
  });

  it("returns defaults when config file has invalid YAML", async () => {
    writeFileSync(join(testDir, "config.yaml"), ":::not valid yaml:::");
    const config = await loadConfig();
    expect(config.llm.provider).toBe("claude");
  });

  it("returns defaults when parsed content is not an object", async () => {
    writeFileSync(join(testDir, "config.yaml"), "just a string");
    const config = await loadConfig();
    expect(config.llm.provider).toBe("claude");
  });

  it("merges partial config with defaults", async () => {
    writeFileSync(
      join(testDir, "config.yaml"),
      `llm:\n  provider: openai\n`,
    );
    const config = await loadConfig();
    expect(config.llm.provider).toBe("openai");
    expect(config.llm.model).toBe("claude-sonnet-4-6"); // default preserved
    expect(config.learning.confidence_threshold).toBe("medium"); // default preserved
  });

  it("loads full valid config correctly", async () => {
    writeFileSync(
      join(testDir, "config.yaml"),
      `llm:
  provider: openai
  model: gpt-4
  api_key_env: OPENAI_API_KEY
learning:
  min_sessions: 5
  confidence_threshold: high
`,
    );
    const config = await loadConfig();
    expect(config.llm.provider).toBe("openai");
    expect(config.llm.model).toBe("gpt-4");
    expect(config.llm.api_key_env).toBe("OPENAI_API_KEY");
    expect(config.learning.min_sessions).toBe(5);
    expect(config.learning.confidence_threshold).toBe("high");
  });

  it("handles each field independently", async () => {
    writeFileSync(
      join(testDir, "config.yaml"),
      `learning:\n  min_sessions: 10\n`,
    );
    const config = await loadConfig();
    // llm section uses all defaults
    expect(config.llm.provider).toBe("claude");
    expect(config.llm.model).toBe("claude-sonnet-4-6");
    // learning.min_sessions overridden, confidence_threshold defaults
    expect(config.learning.min_sessions).toBe(10);
    expect(config.learning.confidence_threshold).toBe("medium");
  });

  it("returns defaults when YAML is an array", async () => {
    writeFileSync(join(testDir, "config.yaml"), "- item1\n- item2\n");
    const config = await loadConfig();
    expect(config.llm.provider).toBe("claude");
  });

  it("returns defaults when YAML is null", async () => {
    writeFileSync(join(testDir, "config.yaml"), "null\n");
    const config = await loadConfig();
    expect(config.llm.provider).toBe("claude");
  });
});
