import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createContentFixture,
  editorId,
  readerId,
} from "./helpers/content-fixture";
import {
  chapterSaveSchema,
  emptyContent,
  publishedBible,
  type ContentSnapshot,
} from "../shared/src/content";
import { verseText } from "../shared/src/scripture";
import { dailyContemplation } from "../../allexi_mobile/src/data/contemplation";

test("editorial database isolates drafts, checks permissions, versions edits and publishes atomically", async (t) => {
  const fixture = await createContentFixture();
  const { database, rpc } = fixture;
  const coordinate = { book: 42, chapter: 3, verse: 16 };
  const args = { p_edition: "allexi", p_book: 42, p_chapter: 3 };
  const edit = (
    text: string,
    expectedRevision: number,
    status = "updated",
  ) => ({ ...coordinate, text, expectedRevision, status });
  const read = () =>
    rpc("reader_scripture_snapshot", {}, null) as Promise<ContentSnapshot>;
  try {
    await t.test(
      "canonical progress accounts for every verse without fabricating Allexi text",
      async () => {
        const summary = (await rpc(
          "admin_scripture_overview",
          { p_edition: "allexi" },
          editorId,
        )) as { chapters: { total: number; updated: number }[] };
        assert.equal(summary.chapters.length, 1189);
        assert.equal(
          summary.chapters.reduce((n, c) => n + c.total, 0),
          31102,
        );
        assert.equal(
          summary.chapters.reduce((n, c) => n + c.updated, 0),
          0,
        );
        assert.deepEqual((await read()).verses, []);
      },
    );
    await t.test(
      "regular readers cannot use editorial RPCs or grant themselves access",
      async () => {
        assert.equal(await rpc("is_content_admin", {}, readerId), false);
        await assert.rejects(
          rpc(
            "save_scripture_chapter",
            { ...args, changes: [edit("Unauthorized", 0)] },
            readerId,
          ),
          { code: "42501" },
        );
        await assert.rejects(
          rpc("admin_scripture_overview", { p_edition: "kjv" }, readerId),
          { code: "42501" },
        );
        await assert.rejects(
          database.transaction(async (tx) => {
            await tx.exec("set local role authenticated");
            await tx.query(
              "insert into app_private.content_admins values($1)",
              [readerId],
            );
          }),
          { code: "42501" },
        );
      },
    );
    await t.test(
      "draft saves are not public and cannot be published before review",
      async () => {
        await rpc(
          "save_scripture_chapter",
          { ...args, changes: [edit("Editorial fixture wording", 0, "draft")] },
          editorId,
        );
        assert.equal((await read()).verses.length, 0);
        await assert.rejects(
          rpc(
            "publish_scripture_chapter",
            { ...args, revisions: [{ verse: 16, revision: 1 }] },
            editorId,
          ),
          { code: "22023" },
        );
        await assert.rejects(
          rpc(
            "set_scripture_default",
            { p_edition: "allexi", expected_revision: 0 },
            editorId,
          ),
          { code: "22023" },
        );
      },
    );
    await t.test(
      "stale revisions fail without overwriting a newer draft",
      async () => {
        await assert.rejects(
          rpc(
            "save_scripture_chapter",
            { ...args, changes: [edit("Stale wording", 0)] },
            editorId,
          ),
          { code: "40001" },
        );
        const chapter = (await rpc(
          "admin_scripture_chapter",
          args,
          editorId,
        )) as { verses: { text: string; verse: number }[] };
        assert.equal(
          chapter.verses.find((v) => v.verse === 16)?.text,
          "Editorial fixture wording",
        );
      },
    );
    await t.test(
      "invalid canonical coordinates are rejected by both validation and SQL",
      async () => {
        assert.equal(
          chapterSaveSchema.safeParse({
            edition: "allexi",
            book: 42,
            chapter: 3,
            changes: [{ ...edit("Wrong verse", 0), verse: 99 }],
          }).success,
          false,
        );
        await assert.rejects(
          rpc(
            "save_scripture_chapter",
            { ...args, changes: [{ ...edit("Wrong verse", 0), verse: 99 }] },
            editorId,
          ),
          { code: "22023" },
        );
      },
    );
    await t.test(
      "review and publish expose the selected revision, preserve history and isolate editions",
      async () => {
        await rpc(
          "save_scripture_chapter",
          { ...args, changes: [edit("Reviewed fixture wording", 1)] },
          editorId,
        );
        await rpc(
          "publish_scripture_chapter",
          { ...args, revisions: [{ verse: 16, revision: 2 }] },
          editorId,
        );
        const snapshot = await read();
        assert.equal(snapshot.verses[0].text, "Reviewed fixture wording");
        assert.equal(snapshot.revision, 1);
        await rpc(
          "publish_scripture_chapter",
          { ...args, revisions: [{ verse: 16, revision: 2 }] },
          editorId,
        );
        assert.equal(
          (await read()).revision,
          1,
          "Publishing an existing revision is idempotent",
        );
        const history = (await rpc(
          "admin_scripture_history",
          { ...args, p_verse: 16 },
          editorId,
        )) as { action: string; revision: number }[];
        assert.deepEqual(
          history.map((h) => h.action),
          ["publish", "mark_updated", "save_draft"],
        );
        assert.equal(
          publishedBible(snapshot, "kjv").text(coordinate),
          verseText(coordinate),
        );
        const allexi = publishedBible(snapshot, "allexi");
        assert.equal(allexi.text(coordinate), "Reviewed fixture wording");
        assert.equal(allexi.text({ ...coordinate, verse: 17 }), "");
        assert.equal(allexi.verses.length, 1);
      },
    );
    await t.test(
      "editing a published verse does not expose its new draft",
      async () => {
        await rpc(
          "save_scripture_chapter",
          { ...args, changes: [edit("Unpublished follow-up", 2, "draft")] },
          editorId,
        );
        assert.equal((await read()).verses[0].text, "Reviewed fixture wording");
        await assert.rejects(
          rpc(
            "publish_scripture_chapter",
            { ...args, revisions: [{ verse: 16, revision: 2 }] },
            editorId,
          ),
          { code: "40001" },
        );
      },
    );
    await t.test(
      "default switches are versioned and only use published Allexi text",
      async () => {
        await rpc(
          "set_scripture_default",
          { p_edition: "allexi", expected_revision: 1 },
          editorId,
        );
        const snapshot = await read();
        assert.equal(snapshot.defaultEdition, "allexi");
        assert.equal(snapshot.revision, 2);
        await assert.rejects(
          rpc(
            "set_scripture_default",
            { p_edition: "kjv", expected_revision: 1 },
            editorId,
          ),
          { code: "40001" },
        );
        const pool = publishedBible(snapshot, "allexi").verses;
        assert.equal(
          dailyContemplation(new Date(), pool)?.text,
          "Reviewed fixture wording",
        );
        assert.equal(dailyContemplation(new Date(), []), null);
      },
    );
    await t.test(
      "a conflicting batch rolls back every verse in the chapter",
      async () => {
        await assert.rejects(
          rpc(
            "save_scripture_chapter",
            {
              ...args,
              changes: [
                { ...edit("Should roll back", 0), verse: 17 },
                edit("Stale", 1),
              ],
            },
            editorId,
          ),
          { code: "40001" },
        );
        const row = await database.query(
          "select * from public.scripture_drafts where edition=$1 and book=42 and chapter=3 and verse=17",
          ["allexi"],
        );
        assert.equal(row.rows.length, 0);
      },
    );
  } finally {
    await database.close();
  }
});

test("empty Allexi content never silently inherits KJV wording", () => {
  assert.equal(publishedBible(emptyContent, "allexi").verses.length, 0);
  assert.equal(publishedBible(emptyContent, "kjv").verses.length, 31102);
});
