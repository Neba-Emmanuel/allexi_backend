import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecureSessionStorage } from "../../allexi_mobile/src/lib/secureSession";
const memory = () => {
  const rows = new Map<string, string>();
  return {
    rows,
    getItem: async (key: string) => rows.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      rows.set(key, value);
    },
    removeItem: async (key: string) => {
      rows.delete(key);
    },
  };
};
test("native session storage migrates plaintext sessions and supports long non-ASCII values", async () => {
  const secure = memory(),
    legacy = memory();
  legacy.rows.set("auth", "old-session");
  let version = 0;
  const storage = createSecureSessionStorage(secure, legacy, () =>
    String(++version),
  );
  assert.equal(await storage.getItem("auth"), "old-session");
  assert.equal(legacy.rows.size, 0);
  const long = "A large session 🕊️".repeat(500);
  await storage.setItem("auth", long);
  assert.equal(await storage.getItem("auth"), long);
  assert.ok(
    [...secure.rows.values()].every((value) => Buffer.byteLength(value) < 2048),
  );
  await storage.removeItem("auth");
  assert.equal(await storage.getItem("auth"), null);
  assert.equal(secure.rows.size, 0);
});
test("an interrupted secure session write preserves the previously committed session", async () => {
  const secure = memory(),
    legacy = memory();
  let version = 0,
    fail = false;
  const storage = createSecureSessionStorage(
    {
      ...secure,
      setItem: async (key, value) => {
        if (fail && key.endsWith(".1")) throw new Error("Storage full");
        await secure.setItem(key, value);
      },
    },
    legacy,
    () => String(++version),
  );
  await storage.setItem("auth", "previous-session");
  fail = true;
  await assert.rejects(
    storage.setItem("auth", "new-session".repeat(200)),
    /Storage full/,
  );
  assert.equal(await storage.getItem("auth"), "previous-session");
});
