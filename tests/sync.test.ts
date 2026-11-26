import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeSync,
  mutationSchema,
  syncRequestSchema,
  type Annotation,
} from "../shared/src/index";

const row: Annotation = {
  id: "42.3.16.note",
  kind: "note",
  book: 42,
  chapter: 3,
  verse: 16,
  text: "A reflection",
  color: null,
  deleted: false,
  mutation_id: "00000000-0000-4000-8000-000000000001",
  revision: 0,
  dirty: true,
};
test("a note edited during sync remains dirty and is not replaced by the response", () => {
  const current = {
    ...row,
    text: "A newer reflection",
    mutation_id: "00000000-0000-4000-8000-000000000002",
  };
  const merged = mergeSync([current], {
    records: [{ ...row, revision: 1 }],
    acknowledged: [row.mutation_id],
  });
  assert.equal(merged[0].text, "A newer reflection");
  assert.equal(merged[0].dirty, true);
});
test("a retry acknowledges the precise submitted mutation and applies server revision", () => {
  const result = mergeSync([row], {
    records: [{ ...row, revision: 4 }],
    acknowledged: [row.mutation_id],
  });
  assert.equal(result[0].dirty, false);
  assert.equal(result[0].revision, 4);
});
test("remote deletions survive merge; pending local edits are retained", () => {
  assert.equal(
    mergeSync([{ ...row, dirty: false }], {
      records: [{ ...row, deleted: true, revision: 2 }],
      acknowledged: [],
    })[0].deleted,
    true,
  );
  assert.equal(
    mergeSync([row], {
      records: [{ ...row, deleted: true, revision: 2 }],
      acknowledged: [],
    })[0].deleted,
    false,
  );
});
test("a failed or empty response never drops unacknowledged changes", () => {
  assert.deepEqual(mergeSync([row], { records: [], acknowledged: [] }), [row]);
});
test("validation rejects forged coordinates, identity injection and oversized batches", () => {
  const { dirty, revision, ...mutation } = row;
  assert.equal(mutationSchema.safeParse(mutation).success, true);
  assert.equal(
    mutationSchema.safeParse({ ...mutation, user_id: "another-user" }).success,
    false,
  );
  assert.equal(
    mutationSchema.safeParse({ ...mutation, id: "0.1.1.note" }).success,
    false,
  );
  assert.equal(
    syncRequestSchema.safeParse({ changes: Array(101).fill(mutation) }).success,
    false,
  );
});
