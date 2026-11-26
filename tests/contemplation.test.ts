import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dailyContemplation,
  contemplationDateKey,
} from "../../allexi_mobile/src/data/contemplation";
import { verseText } from "../shared/src/scripture";

test("daily contemplation is stable throughout the local calendar day", () => {
  const morning = new Date(2026, 9, 21, 0, 0, 0);
  const evening = new Date(2026, 9, 21, 23, 59, 59);
  assert.equal(contemplationDateKey(morning), "2026-10-21");
  assert.deepEqual(dailyContemplation(morning), dailyContemplation(evening));
});

test("new days select varied valid passages whose references match their text", () => {
  const passages = Array.from({ length: 31 }, (_, day) =>
    dailyContemplation(new Date(2026, 9, day + 1)),
  );
  assert.ok(
    new Set(passages.map((p) => `${p.book}.${p.chapter}.${p.verse}`)).size > 25,
  );
  for (const passage of passages) {
    assert.ok(passage.text.length > 0);
    assert.equal(passage.text, verseText(passage));
  }
  assert.notDeepEqual(
    dailyContemplation(new Date(2026, 9, 21)),
    dailyContemplation(new Date(2026, 9, 22)),
  );
});
