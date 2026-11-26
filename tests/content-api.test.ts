import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app";
import {
  createContentFixture,
  editorToken,
  readerToken,
} from "./helpers/content-fixture";

test("content HTTP API verifies admin accounts and serves only published revisions", async (t) => {
  const fixture = await createContentFixture();
  const server = createApp({
    url: "http://content-fixture.test",
    key: "fixture-key",
    origins: [],
    clientFactory: fixture.factory,
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  async function request(
    path: string,
    token?: string,
    body?: unknown,
    method = body ? "POST" : "GET",
  ) {
    return fetch(`${origin}/v1/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  try {
    await t.test(
      "anonymous users are denied and forged user metadata does not confer admin access",
      async () => {
        assert.equal((await request("admin/access")).status, 401);
        assert.equal(
          (await request("admin/access", "invalid-token")).status,
          401,
        );
        assert.equal((await request("admin/access", readerToken)).status, 403);
        assert.equal((await request("admin/access", editorToken)).status, 200);
      },
    );
    await t.test(
      "editor saves, reviews, publishes and changes the reader default end-to-end",
      async () => {
        const changes = [
          {
            book: 42,
            chapter: 3,
            verse: 16,
            text: "API editorial fixture text",
            status: "updated",
            expectedRevision: 0,
          },
        ];
        assert.equal(
          (
            await request(
              "admin/content/chapter",
              editorToken,
              { edition: "allexi", book: 42, chapter: 3, changes },
              "PUT",
            )
          ).status,
          200,
        );
        assert.equal(
          (await (await request("content")).json()).verses.length,
          0,
        );
        assert.equal(
          (
            await request(
              "admin/content/chapter",
              editorToken,
              { edition: "allexi", book: 42, chapter: 3, changes },
              "PUT",
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request("admin/content/publish", editorToken, {
              edition: "allexi",
              book: 42,
              chapter: 3,
              revisions: [{ verse: 16, revision: 1 }],
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request(
              "admin/content/default-edition",
              editorToken,
              { edition: "allexi", expectedRevision: 1 },
              "PUT",
            )
          ).status,
          200,
        );
        const response = await request("content"),
          snapshot = await response.json();
        assert.equal(snapshot.defaultEdition, "allexi");
        assert.equal(snapshot.verses[0].text, "API editorial fixture text");
        assert.equal(snapshot.verses[0].updated_by, undefined);
        assert.equal(snapshot.verses[0].actor_id, undefined);
        const cached = await fetch(`${origin}/v1/content`, {
          headers: { "If-None-Match": response.headers.get("ETag")! },
        });
        assert.equal(cached.status, 304);
        const history = await (
          await request(
            "admin/content/history?edition=allexi&book=42&chapter=3&verse=16",
            editorToken,
          )
        ).json();
        assert.equal(history.length, 2);
        const chapter = await (
          await request(
            "admin/content/chapter?edition=kjv&book=42&chapter=3",
            editorToken,
          )
        ).json();
        assert.match(chapter.verses[15].text, /For God so loved the world/);
      },
    );
    await t.test(
      "malformed verses and ownership injection are rejected before writing",
      async () => {
        const response = await request(
          "admin/content/chapter",
          editorToken,
          {
            edition: "allexi",
            book: 42,
            chapter: 3,
            changes: [
              {
                book: 42,
                chapter: 3,
                verse: 99,
                text: "Invalid",
                status: "updated",
                expectedRevision: 0,
              },
            ],
          },
          "PUT",
        );
        assert.equal(response.status, 400);
        const forged = await request(
          "admin/content/chapter",
          editorToken,
          {
            edition: "allexi",
            book: 42,
            chapter: 3,
            changes: [
              {
                book: 42,
                chapter: 3,
                verse: 17,
                text: "Invalid",
                status: "updated",
                expectedRevision: 0,
                updated_by: "forged",
              },
            ],
          },
          "PUT",
        );
        assert.equal(forged.status, 400);
      },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fixture.database.close();
  }
});
