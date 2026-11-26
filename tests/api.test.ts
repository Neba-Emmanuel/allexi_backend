import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app";
test("unconfigured API reports readiness honestly and never accepts unauthenticated sync", async () => {
  const server = createApp({ origins: [] }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve()),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const scripture = await (await fetch(`${origin}/v1/content`)).json();
    assert.equal(scripture.configured, false);
    assert.equal(scripture.defaultEdition, "allexi");
    assert.equal(scripture.verses.length, 31);
    assert.equal(scripture.verses[0].text, "At the start, the lord created the heaven and the earth.");
    const health = await fetch(`${origin}/health`);
    assert.equal(health.status, 503);
    const sync = await fetch(`${origin}/v1/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: [] }),
    });
    assert.equal(sync.status, 401);
    const configured = await fetch(`${origin}/v1/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer fake",
      },
      body: JSON.stringify({ changes: [] }),
    });
    assert.equal(configured.status, 503);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
