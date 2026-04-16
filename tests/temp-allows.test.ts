import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let testDir: string;
const originalEnv = process.env.CC_GUARD_DIR;

beforeEach(() => {
  testDir = join(tmpdir(), `cc-guard-test-ta-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  process.env.CC_GUARD_DIR = testDir;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  if (originalEnv) {
    process.env.CC_GUARD_DIR = originalEnv;
  } else {
    delete process.env.CC_GUARD_DIR;
  }
  // Clear module cache to reset state
  delete require.cache[require.resolve("../src/temp-allows")];
});

// Dynamic import to pick up CC_GUARD_DIR changes
async function getTempAllows() {
  // Force re-import
  delete require.cache[require.resolve("../src/temp-allows")];
  return await import("../src/temp-allows");
}

describe("temp-allows — loadTempAllows", () => {
  it("returns empty array when file does not exist", async () => {
    const { loadTempAllows } = await getTempAllows();
    expect(loadTempAllows()).toEqual([]);
  });

  it("returns empty array on corrupt JSON", async () => {
    writeFileSync(join(testDir, "temp-allows.json"), "not json{{{");
    const { loadTempAllows } = await getTempAllows();
    expect(loadTempAllows()).toEqual([]);
  });

  it("returns empty array when file contains non-array", async () => {
    writeFileSync(join(testDir, "temp-allows.json"), '{"key": "value"}');
    const { loadTempAllows } = await getTempAllows();
    expect(loadTempAllows()).toEqual([]);
  });
});

describe("temp-allows — saveTempAllows + loadTempAllows roundtrip", () => {
  it("saves and loads entries", async () => {
    const { saveTempAllows, loadTempAllows } = await getTempAllows();
    const entries = [
      {
        pattern: "test pattern",
        type: "once" as const,
        uses_remaining: 1,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
    ];
    saveTempAllows(entries);
    const loaded = loadTempAllows();
    expect(loaded.length).toBe(1);
    expect(loaded[0].pattern).toBe("test pattern");
    expect(loaded[0].uses_remaining).toBe(1);
  });
});

describe("temp-allows — addTempAllow", () => {
  it("creates once entry with uses_remaining=1", async () => {
    const { addTempAllow, loadTempAllows } = await getTempAllows();
    addTempAllow("^test", "once");
    const allows = loadTempAllows();
    expect(allows.length).toBe(1);
    expect(allows[0].type).toBe("once");
    expect(allows[0].uses_remaining).toBe(1);
    expect(allows[0].pattern).toBe("^test");
  });

  it("creates session entry without uses_remaining", async () => {
    const { addTempAllow, loadTempAllows } = await getTempAllows();
    addTempAllow("^test", "session");
    const allows = loadTempAllows();
    expect(allows.length).toBe(1);
    expect(allows[0].type).toBe("session");
    expect(allows[0].uses_remaining).toBeUndefined();
  });

  it("increments uses_remaining for duplicate once pattern", async () => {
    const { addTempAllow, loadTempAllows } = await getTempAllows();
    addTempAllow("^test", "once");
    addTempAllow("^test", "once");
    const allows = loadTempAllows();
    expect(allows.length).toBe(1);
    expect(allows[0].uses_remaining).toBe(2);
  });

  it("no-op for duplicate session pattern", async () => {
    const { addTempAllow, loadTempAllows } = await getTempAllows();
    addTempAllow("^test", "session");
    addTempAllow("^test", "session");
    const allows = loadTempAllows();
    expect(allows.length).toBe(1);
  });

  it("sets 24h TTL", async () => {
    const { addTempAllow, loadTempAllows } = await getTempAllows();
    const before = Date.now();
    addTempAllow("^test", "once");
    const allows = loadTempAllows();
    const expiresMs = new Date(allows[0].expires_at).getTime();
    const expectedMs = before + 24 * 60 * 60 * 1000;
    // Within 5 seconds
    expect(Math.abs(expiresMs - expectedMs)).toBeLessThan(5000);
  });
});

describe("temp-allows — getActiveTempAllows", () => {
  it("filters expired entries", async () => {
    const { saveTempAllows, getActiveTempAllows } = await getTempAllows();
    saveTempAllows([
      {
        pattern: "expired",
        type: "once",
        uses_remaining: 1,
        created_at: "2020-01-01T00:00:00Z",
        expires_at: "2020-01-02T00:00:00Z", // long expired
      },
      {
        pattern: "active",
        type: "once",
        uses_remaining: 1,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
    ]);
    const active = getActiveTempAllows();
    expect(active.length).toBe(1);
    expect(active[0].pattern).toBe("active");
  });
});

describe("temp-allows — consumeTempAllow", () => {
  it("returns true and decrements once entry", async () => {
    const { addTempAllow, consumeTempAllow, loadTempAllows } = await getTempAllows();
    addTempAllow("git reset --hard", "once");
    const result = consumeTempAllow("git reset --hard");
    expect(result).toBe(true);
    // Entry should be removed (uses_remaining was 1, now 0)
    const allows = loadTempAllows();
    expect(allows.length).toBe(0);
  });

  it("returns true for session entry without decrementing", async () => {
    const { addTempAllow, consumeTempAllow, loadTempAllows } = await getTempAllows();
    addTempAllow("git reset --hard", "session");
    const result = consumeTempAllow("git reset --hard");
    expect(result).toBe(true);
    // Entry should still exist
    const allows = loadTempAllows();
    expect(allows.length).toBe(1);
  });

  it("returns false for non-matching pattern", async () => {
    const { addTempAllow, consumeTempAllow } = await getTempAllows();
    addTempAllow("git reset --hard", "once");
    const result = consumeTempAllow("^sudo ");
    expect(result).toBe(false);
  });

  it("uses string equality not regex", async () => {
    const { addTempAllow, consumeTempAllow } = await getTempAllows();
    addTempAllow("^rm -rf ", "once");
    // Different string, should not match even though regex would
    const result = consumeTempAllow("rm -rf");
    expect(result).toBe(false);
  });

  it("filters expired before matching", async () => {
    const { saveTempAllows, consumeTempAllow } = await getTempAllows();
    saveTempAllows([
      {
        pattern: "test",
        type: "once",
        uses_remaining: 1,
        created_at: "2020-01-01T00:00:00Z",
        expires_at: "2020-01-02T00:00:00Z", // expired
      },
    ]);
    const result = consumeTempAllow("test");
    expect(result).toBe(false);
  });
});

describe("temp-allows — removeTempAllow", () => {
  it("removes matching entry", async () => {
    const { addTempAllow, removeTempAllow, loadTempAllows } = await getTempAllows();
    addTempAllow("^test", "once");
    const removed = removeTempAllow("^test");
    expect(removed).toBe(true);
    expect(loadTempAllows().length).toBe(0);
  });

  it("returns false for non-matching pattern", async () => {
    const { addTempAllow, removeTempAllow } = await getTempAllows();
    addTempAllow("^test", "once");
    const removed = removeTempAllow("^other");
    expect(removed).toBe(false);
  });
});

describe("temp-allows — clearTempAllows", () => {
  it("removes all entries and returns count", async () => {
    const { addTempAllow, clearTempAllows, loadTempAllows } = await getTempAllows();
    addTempAllow("a", "once");
    addTempAllow("b", "session");
    const count = clearTempAllows();
    expect(count).toBe(2);
    expect(loadTempAllows().length).toBe(0);
  });

  it("returns 0 when empty", async () => {
    const { clearTempAllows } = await getTempAllows();
    expect(clearTempAllows()).toBe(0);
  });
});
