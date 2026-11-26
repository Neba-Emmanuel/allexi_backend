import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { contentSnapshotSchema } from "../shared/src/content";

test("one-file Supabase setup exposes published Allexi content and preserves an existing installation", async () => {
  const db = new PGlite();
  try {
    // Supabase provides these roles, auth table and auth.uid() in production.
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;`);
    const sql = await readFile(new URL("../supabase/setup.sql", import.meta.url), "utf8");
    await db.exec(sql);
    const { rows } = await db.query<{ version: string; snapshot: unknown }>(
      "select public.app_readiness() as version, public.reader_scripture_snapshot() as snapshot",
    );
    assert.equal(rows[0].version, "202611130001");
    const snapshot = contentSnapshotSchema.parse(rows[0].snapshot);
    assert.equal(snapshot.defaultEdition, "allexi");
    assert.equal(snapshot.verses.length, 31);
    assert.equal(snapshot.verses[0].text, "At the start, the lord created the heaven and the earth.");
    await db.exec("insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000009','Allexhairdrick@icloud.com')");
    const grant = await readFile(new URL("../supabase/grant-support-admin.sql", import.meta.url), "utf8");
    await db.exec(grant);
    await db.exec(grant);
    const admins = await db.query<{ count: number }>("select count(*)::int as count from app_private.content_admins");
    assert.equal(admins.rows[0].count, 1);
    await db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      await tx.query("select public.app_readiness(), public.reader_scripture_snapshot()");
    });
    await assert.rejects(db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      await tx.query("select * from app_private.content_admins");
    }), { code: "42501" });
    await assert.rejects(db.exec(sql), /Allexi tables already exist/);
    await db.exec("rollback");
    const remaining = await db.query<{ count: number }>("select count(*)::int as count from public.scripture_publications");
    assert.equal(remaining.rows[0].count, 31);
  } finally {
    await db.close();
  }
});
