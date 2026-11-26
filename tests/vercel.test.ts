import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readConfig } from "../src/config";

const services = {
  SUPABASE_URL: "https://allexi-test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SERVICE_ROLE_KEY: "server-test-key",
  CORS_ORIGINS: "https://reader.allexi.test",
};

test("Vercel preview and production validate services and use a bounded proxy default", () => {
  for (const environment of ["preview", "production"]) {
    const cloud = { VERCEL: "1", VERCEL_ENV: environment, NODE_ENV: "development" };
    assert.throws(() => readConfig(cloud), /Production requires/);
    const config = readConfig({ ...cloud, ...services });
    assert.equal(config.production, true);
    assert.equal(config.trustProxy, 1);
    assert.equal(readConfig({ ...cloud, ...services, TRUST_PROXY_HOPS: "0" }).trustProxy, 0);
    assert.throws(() => readConfig({ ...cloud, ...services, CORS_ORIGINS: "http://localhost:8081" }), /CORS_ORIGINS/);
  }
  assert.equal(readConfig({}).trustProxy, 0);
  assert.equal(readConfig({ VERCEL: "1", VERCEL_ENV: "development" }).production, false);
});

test("serverless entrypoint exports an Express app without starting its own listener", () => {
  const env = { ...process.env, NODE_ENV: "development" };
  for (const key of ["VERCEL", "VERCEL_ENV", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CORS_ORIGINS", "TRUST_PROXY_HOPS", "PORT"])
    delete (env as NodeJS.ProcessEnv)[key];
  const result = spawnSync(process.execPath, [
    "--import", "tsx", "--input-type=module", "--eval",
    `import assert from 'node:assert/strict';
     import app from './index.ts';
     assert.equal(typeof app, 'function');
     assert.equal(typeof app.listen, 'function');
     assert.equal(app.get('trust proxy'), 0);
     assert.equal(app.disabled('x-powered-by'), true);
     console.log('serverless_export_ok');`,
  ], { cwd: new URL("../", import.meta.url), env, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /serverless_export_ok/);
});
