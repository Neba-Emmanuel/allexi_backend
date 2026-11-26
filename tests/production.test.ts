import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { readConfig } from "../src/config";
import { createApp } from "../src/app";
import {
  syncResponseSchema,
  mutationSchema,
} from "../shared/src/index";
import {
  createContentFixture,
  editorId,
  readerId,
  editorToken,
  fixtureUser,
} from "./helpers/content-fixture";
const require = createRequire(import.meta.url);
const { validateReleaseEnvironment } = require("../../allexi_mobile/scripts/release-config.cjs");
const change = (verse = 1) => ({
  id: `0.1.${verse}.note`,
  kind: "note",
  book: 0,
  chapter: 1,
  verse,
  text: "Private note",
  color: null,
  deleted: false,
  mutation_id: "00000000-0000-4000-8000-000000000099",
});
async function releaseFixture() {
  const fixture = await createContentFixture();
  for (const name of [
    "202610310001_allexi_genesis_1.sql",
    "202610310002_allexi_default.sql",
    "202611130001_production_hardening.sql",
  ]) {
    await fixture.database.exec(
      await readFile(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  }
  return fixture;
}

test("production configuration rejects missing services, HTTP endpoints, wildcard CORS and private public keys", () => {
  assert.throws(() => readConfig({ NODE_ENV: "production" }));
  const env = {
    NODE_ENV: "production",
    SUPABASE_URL: "https://allexi-test.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_SERVICE_ROLE_KEY: "server-key",
    CORS_ORIGINS: "https://allexi.test",
    TRUST_PROXY_HOPS: "1",
  };
  assert.equal(readConfig(env).trustProxy, 1);
  for (const invalid of [
    { PORT: "NaN" },
    { TRUST_PROXY_HOPS: "true" },
    { SUPABASE_URL: "http://allexi-test.supabase.co" },
    { CORS_ORIGINS: "*" },
    { SUPABASE_PUBLISHABLE_KEY: "sb_secret_test" },
  ])
    assert.throws(() => readConfig({ ...env, ...invalid }));
  const mobile = {
    EXPO_PUBLIC_SUPABASE_URL: env.SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY,
    EXPO_PUBLIC_API_URL: "https://api.allexi.test",
    EXPO_PUBLIC_PRIVACY_URL: "https://allexi.test/privacy",
    EXPO_PUBLIC_SUPPORT_URL: "https://allexi.test/support",
  };
  assert.doesNotThrow(() => validateReleaseEnvironment(mobile));
  assert.throws(() =>
    validateReleaseEnvironment({
      ...mobile,
      EXPO_PUBLIC_API_URL: "http://192.168.1.10:3001",
    }),
  );
  assert.throws(() =>
    validateReleaseEnvironment({
      ...mobile,
      EXPO_PUBLIC_SERVICE_ROLE_KEY: "private",
    }),
  );
});

test("sync validation rejects noncanonical references and malformed responses", () => {
  assert.equal(mutationSchema.safeParse(change(32)).success, false);
  assert.equal(
    syncResponseSchema.safeParse({
      records: [{ ...change(), revision: 1 }],
      acknowledged: [change().mutation_id],
    }).success,
    true,
  );
  assert.equal(
    syncResponseSchema.safeParse({
      records: [{ ...change(), revision: -1 }],
      acknowledged: [],
    }).success,
    false,
  );
  assert.equal(
    syncResponseSchema.safeParse({
      records: [],
      acknowledged: ["not-a-mutation"],
    }).success,
    false,
  );
});

test("production migrations protect direct RPC writes, isolate users and preserve content after deleting editors", async () => {
  const { database, rpc } = await releaseFixture();
  try {
    assert.deepEqual(
      (await database.query("select public.app_readiness() as version")).rows,
      [{ version: "202611130001" }],
    );
    const result = await rpc("sync_library", { changes: [change()] }, editorId);
    assert.equal(syncResponseSchema.parse(result).records.length, 1);
    assert.equal(
      syncResponseSchema.parse(
        await rpc("sync_library", { changes: [] }, readerId),
      ).records.length,
      0,
    );
    await assert.rejects(
      rpc("sync_library", { changes: [change(32)] }, editorId),
      { code: "22023" },
    );
    await assert.rejects(
      rpc(
        "sync_library",
        { changes: [{ ...change(), user_id: readerId }] },
        editorId,
      ),
      { code: "22023" },
    );
    await assert.rejects(
      database.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query("select app_private.sync_library('[]'::jsonb)");
      }),
      { code: "42501" },
    );
    const args = { p_edition: "allexi", p_book: 0, p_chapter: 1 };
    await rpc(
      "save_scripture_chapter",
      {
        ...args,
        changes: [
          {
            book: 0,
            chapter: 1,
            verse: 1,
            text: "Reviewed by editor",
            status: "updated",
            expectedRevision: 1,
          },
        ],
      },
      editorId,
    );
    await rpc(
      "publish_scripture_chapter",
      { ...args, revisions: [{ verse: 1, revision: 2 }] },
      editorId,
    );
    await database.query("delete from auth.users where id=$1", [editorId]);
    assert.equal(
      (
        await database.query(
          "select count(*)::int as count from public.library_records",
        )
      ).rows[0].count,
      0,
    );
    assert.equal(
      (
        await database.query(
          "select text from public.scripture_publications where edition='allexi' and book=0 and chapter=1 and verse=1",
        )
      ).rows[0].text,
      "Reviewed by editor",
    );
    await assert.rejects(rpc("sync_library", { changes: [] }, editorId), {
      code: "28000",
    });
    assert.equal(await rpc("is_content_admin", {}, editorId), false);
  } finally {
    await database.close();
  }
});

test("production API readiness, CORS and password-confirmed account deletion", async () => {
  const fixture = await releaseFixture();
  let deletedId = "";
  const factory = (token?: string) =>
    createClient("http://fixture.test", "fixture-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const url = String(input);
          const json = (body: unknown, status = 200) =>
            new Response(JSON.stringify(body), {
              status,
              headers: { "Content-Type": "application/json" },
            });
          if (url.endsWith("/user"))
            return token === editorToken
              ? json(fixtureUser(editorId))
              : json({ message: "Invalid session" }, 401);
          if (url.includes("/token")) {
            const body = JSON.parse(String(init?.body));
            return body.password === "correct-password"
              ? json({
                  user: fixtureUser(editorId),
                  access_token: editorToken,
                  refresh_token: "refresh",
                  expires_in: 3600,
                  token_type: "bearer",
                })
              : json({ message: "Wrong password" }, 400);
          }
          if (url.includes("/logout")) return json({});
          if (url.includes("/admin/users/")) {
            deletedId = url.split("/").pop()!;
            await fixture.database.query("delete from auth.users where id=$1", [
              deletedId,
            ]);
            return json({ user: fixtureUser(editorId) });
          }
          if (url.includes("/rpc/app_readiness")) return json("202611130001");
          return json({ message: "Unexpected request" }, 500);
        },
      },
    });
  const server = createApp({
    url: "http://fixture.test",
    key: "fixture-key",
    origins: ["https://reader.allexi.test"],
    clientFactory: factory,
    adminFactory: () => factory(),
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const remove = (body: unknown, token?: string) =>
    fetch(`${base}/v1/account`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await fetch(`${base}/ready`)).status, 200);
    assert.equal((await fetch(`${base}/live`)).status, 200);
    assert.equal(
      (
        await fetch(`${base}/v1/content`, {
          headers: { Origin: "https://other.test" },
        })
      ).status,
      403,
    );
    const allowed = await fetch(`${base}/live`, {
      headers: { Origin: "https://reader.allexi.test" },
    });
    assert.equal(
      allowed.headers.get("access-control-allow-origin"),
      "https://reader.allexi.test",
    );
    assert.ok(allowed.headers.get("x-request-id"));
    assert.equal(
      (await remove({ password: "correct-password", confirmation: "DELETE" }))
        .status,
      401,
    );
    assert.equal(
      (
        await remove(
          { password: "wrong-password", confirmation: "DELETE" },
          editorToken,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await remove(
          {
            password: "correct-password",
            confirmation: "DELETE",
            user_id: readerId,
          },
          editorToken,
        )
      ).status,
      400,
    );
    assert.equal(deletedId, "");
    assert.equal(
      (
        await remove(
          { password: "correct-password", confirmation: "DELETE" },
          editorToken,
        )
      ).status,
      204,
    );
    assert.equal(deletedId, editorId);
    assert.equal(
      (
        await fixture.database.query("select id from auth.users where id=$1", [
          readerId,
        ])
      ).rows.length,
      1,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await fixture.database.close();
  }
});
