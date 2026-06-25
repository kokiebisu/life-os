import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  cacheKey,
  CacheNamespace,
  createCache,
  clearAll,
  listNamespaces,
} from "./cache";

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "cache-test-"));
});

afterEach(() => {
  if (existsSync(baseDir)) rmSync(baseDir, { recursive: true, force: true });
});

describe("cacheKey", () => {
  test("joins parts with pipe", () => {
    expect(cacheKey("a", "b", "c")).toBe("a|b|c");
  });

  test("single part", () => {
    expect(cacheKey("foo")).toBe("foo");
  });

  test("empty parts", () => {
    expect(cacheKey()).toBe("");
  });
});

describe("CacheNamespace.get/set", () => {
  test("returns undefined for missing key", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    expect(cache.get("missing")).toBeUndefined();
  });

  test("set then get returns the value", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    cache.set("k", { hello: "world" });
    expect(cache.get<{ hello: string }>("k")).toEqual({ hello: "world" });
  });

  test("set creates the namespace dir", () => {
    new CacheNamespace("created", { baseDir });
    expect(existsSync(join(baseDir, "created"))).toBe(true);
  });

  test("overwrite preserves type and replaces value", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    cache.set("k", "first");
    cache.set("k", "second");
    expect(cache.get<string>("k")).toBe("second");
  });

  test("preserves complex objects", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    const v = { a: [1, 2, 3], b: { c: "x" }, d: null };
    cache.set("k", v);
    expect(cache.get("k")).toEqual(v);
  });
});

describe("CacheNamespace TTL", () => {
  test("ttlMs: 0 means no expiry (expiresAt=0)", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    cache.set("k", "v", { ttlMs: 0 });
    const entries = cache.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0].expiresAt).toBe(0);
  });

  test("expired entry returns undefined and is removed", async () => {
    const cache = new CacheNamespace("ns", { baseDir });
    cache.set("k", "v", { ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.get("k")).toBeUndefined();
    expect(cache.entries()).toHaveLength(0);
  });

  test("non-expired entry returns the value", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    cache.set("k", "v", { ttlMs: 60_000 });
    expect(cache.get("k")).toBe("v");
  });

  test("default ttl applies when not specified", () => {
    const cache = new CacheNamespace("ns", { baseDir, defaultTtlMs: 60_000 });
    cache.set("k", "v");
    const entries = cache.entries();
    expect(entries[0].expiresAt).toBeGreaterThan(Date.now());
  });
});

describe("CacheNamespace.invalidate", () => {
  test("returns true and removes existing key", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    cache.set("k", "v");
    expect(cache.invalidate("k")).toBe(true);
    expect(cache.get("k")).toBeUndefined();
  });

  test("returns false for missing key", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    expect(cache.invalidate("missing")).toBe(false);
  });
});

describe("CacheNamespace.clear / invalidateByPrefix", () => {
  test("clear removes all entries but keeps _stats.json", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.clear()).toBe(3);
    expect(cache.entries()).toHaveLength(0);
    expect(existsSync(join(baseDir, "ns", "_stats.json"))).toBe(true);
  });

  test("clear on empty namespace returns 0", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    expect(cache.clear()).toBe(0);
  });

  test("invalidateByPrefix is currently equivalent to clear", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.invalidateByPrefix("a")).toBe(2);
    expect(cache.entries()).toHaveLength(0);
  });
});

describe("CacheNamespace.entries", () => {
  test("returns metadata for each entry", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    cache.set("a", "value-a");
    cache.set("b", "value-b");
    const entries = cache.entries();
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.sizeBytes).toBeGreaterThan(0);
      expect(e.createdAt).toBeGreaterThan(0);
    }
  });

  test("returns empty array on fresh namespace", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    expect(cache.entries()).toEqual([]);
  });

  test("ignores _stats.json and unrelated files", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    cache.set("a", 1);
    writeFileSync(join(baseDir, "ns", "stray.txt"), "ignore me");
    expect(cache.entries()).toHaveLength(1);
  });
});

describe("CacheNamespace.stats", () => {
  test("hits / misses / writes increment", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    cache.set("k", "v");
    cache.get("k");
    cache.get("missing");
    const s = cache.stats();
    expect(s.writes).toBe(1);
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
  });

  test("invalidations increment on invalidate / clear", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.invalidate("a");
    cache.clear();
    expect(cache.stats().invalidations).toBe(2);
  });

  test("stats persist across namespace instances", () => {
    const c1 = new CacheNamespace("ns", { baseDir });
    c1.set("k", "v");
    c1.get("k");
    const c2 = new CacheNamespace("ns", { baseDir });
    expect(c2.stats().writes).toBe(1);
    expect(c2.stats().hits).toBe(1);
  });

  test("stats() returns a copy (mutation does not affect internal state)", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    cache.set("k", "v");
    const snap = cache.stats();
    snap.writes = 999;
    expect(cache.stats().writes).toBe(1);
  });
});

describe("createCache", () => {
  test("returns a usable CacheNamespace", () => {
    const cache = createCache("factory-ns", { baseDir });
    cache.set("k", "v");
    expect(cache.get("k")).toBe("v");
  });
});

describe("clearAll", () => {
  test("returns 0 when baseDir does not exist", () => {
    expect(clearAll(join(baseDir, "does-not-exist"))).toBe(0);
  });

  test("clears entries across namespaces", () => {
    const a = new CacheNamespace("a", { baseDir });
    const b = new CacheNamespace("b", { baseDir });
    a.set("k1", 1);
    a.set("k2", 2);
    b.set("k1", 1);
    expect(clearAll(baseDir)).toBeGreaterThanOrEqual(3);
    expect(a.entries()).toHaveLength(0);
    expect(b.entries()).toHaveLength(0);
  });
});

describe("listNamespaces", () => {
  test("returns empty when baseDir does not exist", () => {
    expect(listNamespaces(join(baseDir, "missing"))).toEqual([]);
  });

  test("lists existing namespaces with stats and sizes", () => {
    const a = new CacheNamespace("alpha", { baseDir });
    const b = new CacheNamespace("beta", { baseDir });
    a.set("k", "value-a");
    b.set("k1", "x");
    b.set("k2", "y");

    const list = listNamespaces(baseDir);
    const names = list.map((n) => n.namespace).sort();
    expect(names).toEqual(["alpha", "beta"]);

    const beta = list.find((n) => n.namespace === "beta")!;
    expect(beta.entryCount).toBe(2);
    expect(beta.totalSizeBytes).toBeGreaterThan(0);
    expect(beta.stats.writes).toBe(2);
  });

  test("ignores non-directory entries in baseDir", () => {
    new CacheNamespace("real", { baseDir });
    writeFileSync(join(baseDir, "stray.txt"), "ignore");
    const list = listNamespaces(baseDir);
    expect(list.map((n) => n.namespace)).toEqual(["real"]);
  });
});

describe("CacheNamespace error tolerance", () => {
  test("get on a corrupt entry file returns undefined and counts a miss", () => {
    const cache = new CacheNamespace("ns", { baseDir });
    cache.set("k", "v");
    const files = readdirSync(join(baseDir, "ns")).filter(
      (f) => f.endsWith(".json") && f !== "_stats.json",
    );
    writeFileSync(join(baseDir, "ns", files[0]), "not-json");
    expect(cache.get("k")).toBeUndefined();
    expect(cache.stats().misses).toBeGreaterThanOrEqual(1);
  });
});
