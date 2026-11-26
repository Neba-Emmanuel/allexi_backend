import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

export const editorId = "00000000-0000-4000-8000-000000000001";
export const readerId = "00000000-0000-4000-8000-000000000002";
export function fixtureToken(id: string) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 86400 })}.fixture-signature`;
}
export const editorToken = fixtureToken(editorId),
  readerToken = fixtureToken(readerId);
export const fixtureUser = (id: string) => ({
  id,
  aud: "authenticated",
  role: "authenticated",
  email: id === editorId ? "editor@allexi.test" : "reader@allexi.test",
  app_metadata: {},
  user_metadata: id === readerId ? { admin: true, role: "admin" } : {},
  created_at: new Date().toISOString(),
});

export async function createContentFixture() {
  const database = new PGlite();
  await database.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values('${editorId}'),('${readerId}');`);
  await database.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/202610190001_library_sync.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await database.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/202610300001_scripture_admin.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await database.query(
    "insert into app_private.content_admins(user_id) values($1)",
    [editorId],
  );
  const functions: Record<string, { keys: string[]; types: string[] }> = {
    app_readiness: { keys: [], types: [] },
    sync_library: { keys: ["changes"], types: ["jsonb"] },
    is_content_admin: { keys: [], types: [] },
    reader_scripture_snapshot: { keys: [], types: [] },
    admin_scripture_overview: { keys: ["p_edition"], types: ["text"] },
    admin_scripture_chapter: {
      keys: ["p_edition", "p_book", "p_chapter"],
      types: ["text", "integer", "integer"],
    },
    save_scripture_chapter: {
      keys: ["p_edition", "p_book", "p_chapter", "changes"],
      types: ["text", "integer", "integer", "jsonb"],
    },
    publish_scripture_chapter: {
      keys: ["p_edition", "p_book", "p_chapter", "revisions"],
      types: ["text", "integer", "integer", "jsonb"],
    },
    set_scripture_default: {
      keys: ["p_edition", "expected_revision"],
      types: ["text", "integer"],
    },
    admin_scripture_history: {
      keys: ["p_edition", "p_book", "p_chapter", "p_verse"],
      types: ["text", "integer", "integer", "integer"],
    },
  };
  async function rpc(
    name: string,
    args: Record<string, unknown>,
    id: string | null,
  ) {
    const fn = functions[name];
    if (!fn) throw new Error("Unknown fixture RPC");
    return database.transaction(async (tx) => {
      await tx.exec(`set local role ${id ? "authenticated" : "anon"}`);
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
        id ?? "",
      ]);
      const values = fn.keys.map((key, i) =>
        fn.types[i] === "jsonb"
          ? JSON.stringify(args[key])
          : (args[key] ?? null),
      );
      const result = await tx.query<{ value: unknown }>(
        `select public.${name}(${fn.types.map((type, i) => `$${i + 1}::${type}`).join(",")}) as value`,
        values,
      );
      return result.rows[0].value;
    });
  }
  const factory = (token?: string) =>
    createClient("http://content-fixture.test", "fixture-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        fetch: async (input, options) => {
          const url = new URL(
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url,
          );
          const authorization = new Headers(options?.headers).get(
            "Authorization",
          );
          const id =
            authorization === `Bearer ${editorToken}`
              ? editorId
              : authorization === `Bearer ${readerToken}`
                ? readerId
                : null;
          const json = (body: unknown, status = 200) =>
            new Response(JSON.stringify(body), {
              status,
              headers: { "Content-Type": "application/json" },
            });
          if (url.pathname === "/auth/v1/user")
            return id &&
              (
                await database.query("select id from auth.users where id=$1", [
                  id,
                ])
              ).rows.length
              ? json(fixtureUser(id))
              : json({ message: "Invalid session" }, 401);
          if (url.pathname === "/auth/v1/token") {
            const body = JSON.parse(String(options?.body));
            const userId =
              body.email === "editor@allexi.test"
                ? editorId
                : body.email === "reader@allexi.test"
                  ? readerId
                  : null;
            return userId && body.password === "fixture-password"
              ? json({
                  access_token: userId === editorId ? editorToken : readerToken,
                  refresh_token: "fixture-refresh",
                  token_type: "bearer",
                  expires_in: 86400,
                  user: fixtureUser(userId),
                })
              : json({ message: "Invalid credentials" }, 400);
          }
          if (url.pathname === "/auth/v1/logout")
            return new Response(null, { status: 204 });
          if (url.pathname.startsWith("/auth/v1/admin/users/")) {
            const target = url.pathname.split("/").pop()!;
            await database.query("delete from auth.users where id=$1", [
              target,
            ]);
            return json({ user: fixtureUser(target) });
          }
          try {
            return json(
              await rpc(
                url.pathname.split("/").pop()!,
                JSON.parse(String(options?.body ?? "{}")),
                id,
              ),
            );
          } catch (error) {
            const e = error as { code?: string; message?: string };
            return json(
              {
                code: e.code ?? "XX000",
                message: e.message ?? "Database error",
                details: null,
                hint: null,
              },
              400,
            );
          }
        },
      },
    });
  return { database, rpc, factory };
}
