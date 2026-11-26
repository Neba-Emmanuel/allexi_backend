import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  bundledContent,
  contentSnapshotSchema,
  publishedBible,
  type ContentSnapshot,
  type EditorialChapter,
} from "../shared/src/content";
import { createContentFixture, editorId } from "./helpers/content-fixture";

const migration = new URL(
  "../supabase/migrations/202610310001_allexi_genesis_1.sql",
  import.meta.url,
);

test("supplied Genesis text covers all 31 Allexi verses and preserves combined passages", () => {
  assert.equal(contentSnapshotSchema.safeParse(bundledContent).success, true);
  const bible = publishedBible(bundledContent, "allexi");
  const chapter = bible.chapter(0, 1);
  assert.equal(chapter.length, 31);
  assert.deepEqual(chapter.map((v) => v.verse), Array.from({ length: 31 }, (_, i) => i + 1));
  assert.equal(chapter[0].text, "At the start, the lord created the heaven and the earth.");
  assert.equal(chapter[3].text + " " + chapter[4].text,
    "and the lord was pleased with the light, and divided the light from the dark. Then he let it shine for a while, and then it darkened again. He called the light day,” and the dark night. “  so then the first day was formed.");
  assert.equal(chapter[10].text + " " + chapter[11].text,
    "again father said. Earth burst forward with all sort of seed bearing plant,grass, and fruit trees with seeds, and the fruit tree bearing fruit after his kind, and so it was.");
  assert.equal(chapter[26].text, "so the lord created man like his maker.\nAs God he make him God.\nMan and woman he made them.");
  assert.equal(bible.chapter(0, 2).length, 0);
  assert.equal(publishedBible(bundledContent, "kjv").chapter(0, 1)[0].text,
    "In the beginning God created the heaven and the earth.");
});

test("Genesis migration publishes supplied text, tracks progress and preserves later edits", async () => {
  const fixture = await createContentFixture();
  const { database, rpc } = fixture;
  const sql = await readFile(migration, "utf8");
  const args = { p_edition: "allexi", p_book: 0, p_chapter: 1 };
  try {
    await database.exec(sql);
    const snapshot = await rpc("reader_scripture_snapshot", {}, null) as ContentSnapshot;
    assert.equal(snapshot.defaultEdition, "allexi");
    assert.equal(snapshot.revision, 1);
    assert.deepEqual(snapshot.verses.map(({ book, chapter, verse, text }) => ({ book, chapter, verse, text })),
      bundledContent.verses.map(({ book, chapter, verse, text }) => ({ book, chapter, verse, text })));
    const summary = await rpc("admin_scripture_overview", { p_edition: "allexi" }, editorId) as { chapters: { book: number; chapter: number; updated: number; published: number }[] };
    const progress = summary.chapters.find((c) => c.book === 0 && c.chapter === 1)!;
    assert.equal(progress.updated, 31);
    assert.equal(progress.published, 31);
    const history = await rpc("admin_scripture_history", { ...args, p_verse: 27 }, editorId) as { actor_id: string | null; action: string }[];
    assert.equal(history[0].actor_id, null);
    assert.equal(history[0].action, "publish");
    await rpc("save_scripture_chapter", { ...args, changes: [{ book: 0, chapter: 1, verse: 1, text: "Later editorial draft", status: "draft", expectedRevision: 1 }] }, editorId);
    await database.exec(sql);
    const chapter = await rpc("admin_scripture_chapter", args, editorId) as EditorialChapter;
    assert.equal(chapter.verses[0].text, "Later editorial draft");
    assert.equal(chapter.verses[0].revision, 2);
    assert.equal(chapter.verses[0].published_text, bundledContent.verses[0].text);
    assert.equal((await rpc("reader_scripture_snapshot", {}, null) as ContentSnapshot).revision, 1);
  } finally {
    await database.close();
  }
});

test("Genesis import leaves preexisting drafts and reader default untouched", async () => {
  const { database, rpc } = await createContentFixture();
  try {
    await rpc("save_scripture_chapter", { p_edition: "allexi", p_book: 0, p_chapter: 1, changes: [{ book: 0, chapter: 1, verse: 1, text: "Existing private text", status: "draft", expectedRevision: 0 }] }, editorId);
    // A previously selected default is versioned independently of the imported chapter.
    await database.exec("update public.scripture_settings set default_edition='kjv', revision=5 where id");
    await database.exec(await readFile(migration, "utf8"));
    const snapshot = await rpc("reader_scripture_snapshot", {}, null) as ContentSnapshot;
    assert.equal(snapshot.defaultEdition, "kjv");
    assert.equal(snapshot.revision, 6);
    assert.equal(snapshot.verses.length, 30);
    assert.ok(!snapshot.verses.some((v) => v.verse === 1));
  } finally {
    await database.close();
  }
});

test("Allexi default migration switches existing settings and invalidates snapshots once", async () => {
  const { database, rpc } = await createContentFixture();
  try {
    await database.exec(await readFile(migration, "utf8"));
    await rpc("set_scripture_default", { p_edition: "kjv", expected_revision: 1 }, editorId);
    const sql = await readFile(new URL("../supabase/migrations/202610310002_allexi_default.sql", import.meta.url), "utf8");
    await database.exec(sql);
    const snapshot = await rpc("reader_scripture_snapshot", {}, null) as ContentSnapshot;
    assert.equal(snapshot.defaultEdition, "allexi");
    assert.equal(snapshot.revision, 3);
    assert.equal(snapshot.verses.length, 31);
    await database.exec(sql);
    assert.equal((await rpc("reader_scripture_snapshot", {}, null) as ContentSnapshot).revision, 3);
  } finally {
    await database.close();
  }
});
