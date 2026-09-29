import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFileDescriptionStore } from "../src/store.ts";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pi-reasoning-tool-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a missing state file resolves to no custom description", async () => {
  await withTempDir(async (dir) => {
    const store = createFileDescriptionStore(join(dir, "state.json"));
    assert.equal(store.read(), undefined);
  });
});

test("write then read round-trips a description", async () => {
  await withTempDir(async (dir) => {
    const store = createFileDescriptionStore(join(dir, "state.json"));
    store.write("custom description");
    assert.equal(store.read(), "custom description");
  });
});

test("write creates missing parent directories and stores a versioned payload", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "nested", "deeper", "state.json");
    const store = createFileDescriptionStore(path);
    store.write("nested description");

    assert.ok(existsSync(path));
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      version: 1,
      description: "nested description",
    });
  });
});

test("clear removes the custom description", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "state.json");
    const store = createFileDescriptionStore(path);
    store.write("custom description");
    store.clear();
    assert.equal(store.read(), undefined);
    assert.equal(existsSync(path), false);
    // Clearing twice is safe.
    store.clear();
  });
});

test("corrupt, mis-versioned, and empty payloads resolve to no custom description", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "state.json");
    const store = createFileDescriptionStore(path);

    await writeFile(path, "{ not json", "utf8");
    assert.equal(store.read(), undefined);

    await writeFile(path, JSON.stringify({ version: 1, description: "   " }), "utf8");
    assert.equal(store.read(), undefined);

    await writeFile(path, JSON.stringify({ version: 99, description: "future" }), "utf8");
    assert.equal(store.read(), undefined);

    await writeFile(path, JSON.stringify(["array"]), "utf8");
    assert.equal(store.read(), undefined);

    await writeFile(path, JSON.stringify({ version: 1, description: 42 }), "utf8");
    assert.equal(store.read(), undefined);
  });
});

test("write replaces a previously stored description", async () => {
  await withTempDir(async (dir) => {
    const store = createFileDescriptionStore(join(dir, "state.json"));
    store.write("first");
    store.write("second");
    assert.equal(store.read(), "second");
  });
});
