import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app";
import { createContentFixture } from "./helpers/content-fixture";

test("frontend connection checker verifies the API, migrated database, content caching and browser CORS", async () => {
  const fixture = await createContentFixture();
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  try {
    for (const name of [
      "202610310001_allexi_genesis_1.sql",
      "202610310002_allexi_default.sql",
      "202611130001_production_hardening.sql",
    ]) await fixture.database.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
    server = createApp({
      url: "http://fixture.test",
      key: "fixture-key",
      origins: ["https://reader.allexi.test"],
      clientFactory: fixture.factory,
    }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const result = await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL("../../allexi_mobile/scripts/check-connection.mjs", import.meta.url)),
    ], {
      env: {
        ...process.env,
        EXPO_PUBLIC_API_URL: `http://127.0.0.1:${address.port}/`,
        EXPO_PUBLIC_SUPPORT_URL: "https://reader.allexi.test/support/",
      },
      timeout: 15000,
    });
    assert.match(result.stdout, /31 verses; default edition allexi/);
    assert.match(result.stdout, /Content revision cache verified/);
    assert.match(result.stdout, /Browser CORS and authorization preflight verified/);
    assert.match(result.stdout, /Frontend\/API connection checks passed/);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await fixture.database.close();
  }
});
