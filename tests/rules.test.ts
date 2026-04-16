import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getCcGuardDir, loadRules, parseRulesFile } from "../src/rules";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `cc-guard-test-rules-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  process.env.CC_GUARD_DIR = testDir;
});

afterEach(() => {
  delete process.env.CC_GUARD_DIR;
  rmSync(testDir, { recursive: true, force: true });
});

describe("getCcGuardDir", () => {
  it("returns CC_GUARD_DIR env value when set", () => {
    expect(getCcGuardDir()).toBe(testDir);
  });

  it("returns ~/.cc-guard when env unset", () => {
    delete process.env.CC_GUARD_DIR;
    expect(getCcGuardDir()).toBe(join(homedir(), ".cc-guard"));
  });

  it("reads env dynamically on each call", () => {
    const dir1 = getCcGuardDir();
    process.env.CC_GUARD_DIR = "/tmp/other";
    const dir2 = getCcGuardDir();
    expect(dir1).toBe(testDir);
    expect(dir2).toBe("/tmp/other");
  });
});

describe("parseRulesFile", () => {
  it("parses valid YAML with deny and allow", () => {
    const content = `version: 1
deny:
  - pattern: "^rm -rf "
    reason: "Dangerous"
allow:
  - pattern: "^git "
`;
    const rules = parseRulesFile(content);
    expect(rules.version).toBe(1);
    expect(rules.deny).toHaveLength(1);
    expect(rules.deny[0].pattern).toBe("^rm -rf ");
    expect(rules.deny[0].reason).toBe("Dangerous");
    expect(rules.allow).toHaveLength(1);
    expect(rules.allow[0].pattern).toBe("^git ");
  });

  it("returns emptyRules for invalid YAML", () => {
    const rules = parseRulesFile(":::invalid:::");
    expect(rules.version).toBe(1);
    expect(rules.deny).toEqual([]);
    expect(rules.allow).toEqual([]);
  });

  it("returns emptyRules for non-object YAML", () => {
    const rules = parseRulesFile("just a string");
    expect(rules.deny).toEqual([]);
  });

  it("returns emptyRules for null YAML", () => {
    const rules = parseRulesFile("null");
    expect(rules.deny).toEqual([]);
  });

  it("handles missing deny/allow arrays", () => {
    const rules = parseRulesFile("version: 1\n");
    expect(rules.version).toBe(1);
    expect(rules.deny).toEqual([]);
    expect(rules.allow).toEqual([]);
  });

  it("defaults version to 1", () => {
    const rules = parseRulesFile("deny: []\nallow: []\n");
    expect(rules.version).toBe(1);
  });
});

describe("loadRules", () => {
  it("loads global rules from rules.yaml", async () => {
    writeFileSync(
      join(testDir, "rules.yaml"),
      `version: 1
deny:
  - pattern: "^sudo "
    reason: "Elevated privileges"
allow:
  - pattern: "^git "
`,
    );
    const rules = await loadRules();
    expect(rules.deny).toHaveLength(1);
    expect(rules.deny[0].pattern).toBe("^sudo ");
    expect(rules.allow).toHaveLength(1);
  });

  it("returns emptyRules when no file exists", async () => {
    const rules = await loadRules();
    expect(rules.deny).toEqual([]);
    expect(rules.allow).toEqual([]);
  });

  it("merges project overlay with global", async () => {
    writeFileSync(
      join(testDir, "rules.yaml"),
      `version: 1\ndeny:\n  - pattern: "^sudo "\nallow:\n  - pattern: "^git "\n`,
    );
    mkdirSync(join(testDir, "projects"), { recursive: true });
    writeFileSync(
      join(testDir, "projects", "myproject.yaml"),
      `version: 1\ndeny:\n  - pattern: "DROP TABLE"\nallow:\n  - pattern: "^npm "\n`,
    );

    const rules = await loadRules("myproject");
    expect(rules.deny).toHaveLength(2); // global + project deny
    expect(rules.allow).toHaveLength(2); // global + project allow
  });

  it("deny rules are unioned (project cannot remove global deny)", async () => {
    writeFileSync(
      join(testDir, "rules.yaml"),
      `version: 1\ndeny:\n  - pattern: "^sudo "\n`,
    );
    mkdirSync(join(testDir, "projects"), { recursive: true });
    writeFileSync(
      join(testDir, "projects", "test.yaml"),
      `version: 1\ndeny:\n  - pattern: "^rm -rf "\n`,
    );

    const rules = await loadRules("test");
    expect(rules.deny.map((d) => d.pattern)).toContain("^sudo ");
    expect(rules.deny.map((d) => d.pattern)).toContain("^rm -rf ");
  });

  it("same deny pattern in both global and project appears twice", async () => {
    writeFileSync(
      join(testDir, "rules.yaml"),
      `version: 1\ndeny:\n  - pattern: "^sudo "\n`,
    );
    mkdirSync(join(testDir, "projects"), { recursive: true });
    writeFileSync(
      join(testDir, "projects", "dup.yaml"),
      `version: 1\ndeny:\n  - pattern: "^sudo "\n`,
    );

    const rules = await loadRules("dup");
    const sudoCount = rules.deny.filter((d) => d.pattern === "^sudo ").length;
    expect(sudoCount).toBe(2); // concat, not set union
  });

  it("uses global only when project file missing", async () => {
    writeFileSync(
      join(testDir, "rules.yaml"),
      `version: 1\ndeny:\n  - pattern: "^sudo "\nallow:\n  - pattern: "^git "\n`,
    );
    const rules = await loadRules("nonexistent");
    expect(rules.deny).toHaveLength(1);
    expect(rules.allow).toHaveLength(1);
  });
});
