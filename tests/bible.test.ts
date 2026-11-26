import { test } from "node:test";
import assert from "node:assert/strict";
import {
  books,
  allVerses,
  adjacent,
  chapterVerses,
  searchVerses,
} from "../shared/src/scripture";
test("the offline bundle contains the whole KJV canon", () => {
  assert.equal(books.length, 66);
  assert.equal(
    books.reduce((n, b) => n + b.chapters, 0),
    1189,
  );
  assert.equal(allVerses.length, 31102);
  assert.equal(chapterVerses(42, 3).length, 36);
});
test("references and phrases are searched locally", () => {
  const result = searchVerses("John 3:16");
  assert.equal(result.length, 1);
  assert.match(result[0].text, /For God so loved the world/);
  assert.ok(
    searchVerses("born again").some((v) => v.book === 42 && v.chapter === 3),
  );
  assert.equal(searchVerses("Psalm 23").length, 6);
  assert.ok(searchVerses("love", "Old").every((v) => v.book < 39));
});
test("chapter navigation crosses books and stops at the canon boundaries", () => {
  assert.deepEqual(adjacent({ book: 0, chapter: 50, verse: 1 }, 1), {
    book: 1,
    chapter: 1,
    verse: 1,
  });
  assert.deepEqual(adjacent({ book: 0, chapter: 1, verse: 1 }, -1), {
    book: 0,
    chapter: 1,
    verse: 1,
  });
  assert.deepEqual(adjacent({ book: 65, chapter: 22, verse: 1 }, 1), {
    book: 65,
    chapter: 22,
    verse: 1,
  });
});
