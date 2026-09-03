import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Miniflare } from "miniflare";

const adminEmail = "admin@vegwatch.local";
const adminPassword = "correct-horse-battery-staple";
const persistenceRoot = await mkdtemp(join(tmpdir(), "vegwatch-smoke-"));

const options = {
  modules: true,
  scriptPath: "dist/server/index.js",
  modulesRoot: "dist/server",
  modulesRules: [{ type: "ESModule", include: ["**/*.js", "**/*.mjs"] }],
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  bindings: {
    VEGWATCH_AUTH_MODE: "local",
    VEGWATCH_ADMIN_EMAIL: adminEmail,
    VEGWATCH_ADMIN_PASSWORD: adminPassword,
  },
  d1Databases: { DB: "vegwatch-local" },
  d1Persist: join(persistenceRoot, "d1"),
  r2Buckets: { BUCKET: "vegwatch-local-files" },
  r2Persist: join(persistenceRoot, "r2"),
  assets: {
    directory: "dist/client",
    binding: "ASSETS",
    routerConfig: {
      has_user_worker: true,
      invoke_user_worker_ahead_of_assets: true,
    },
  },
};

let miniflare;
try {
  miniflare = new Miniflare(options);
  const database = await miniflare.getD1Database("DB");
  for (const migrationName of [
    "drizzle/0000_high_shocker.sql",
    "drizzle/0001_abandoned_franklin_richards.sql",
  ]) {
    const migration = await readFile(migrationName, "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await database.prepare(statement).run();
    }
  }

  const health = await miniflare.dispatchFetch("http://vegwatch.local/api/health");
  assert.equal(health.status, 200);

  const anonymous = await miniflare.dispatchFetch("http://vegwatch.local/");
  const anonymousBody = await anonymous.text();
  assert.equal(anonymous.status, 200);
  assert.match(anonymousBody, /Вход в систему/);

  const login = await miniflare.dispatchFetch("http://vegwatch.local/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  assert.equal(login.status, 200, await login.text());
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  assert.match(cookie, /^vegwatch_session=/);

  const dashboard = await miniflare.dispatchFetch("http://vegwatch.local/", {
    headers: { cookie },
  });
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /VegWatch/);

  const createUser = await miniflare.dispatchFetch("http://vegwatch.local/api/users", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      email: "analyst@vegwatch.local",
      displayName: "Тестовый аналитик",
      password: "another-strong-password",
      role: "analyst",
    }),
  });
  assert.equal(createUser.status, 201, await createUser.text());

  const csv = "date,ndvi\n2026-06-01,0.55\n2026-06-11,0.61\n";
  const upload = await miniflare.dispatchFetch("http://vegwatch.local/api/uploads", {
    method: "POST",
    headers: {
      "content-type": "text/csv",
      "content-length": String(new TextEncoder().encode(csv).byteLength),
      "x-file-name": encodeURIComponent("smoke-test.csv"),
      "x-file-size": String(new TextEncoder().encode(csv).byteLength),
      cookie,
    },
    body: csv,
  });
  assert.equal(upload.status, 201, await upload.text());

  const bucket = await miniflare.getR2Bucket("BUCKET");
  assert.equal((await bucket.list()).objects.length, 1);

  await miniflare.dispose();
  const rotatedPassword = "rotated-admin-password";
  miniflare = new Miniflare({
    ...options,
    bindings: { ...options.bindings, VEGWATCH_ADMIN_PASSWORD: rotatedPassword },
  });

  const secondLogin = await miniflare.dispatchFetch("http://vegwatch.local/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: rotatedPassword }),
  });
  assert.equal(secondLogin.status, 200, await secondLogin.text());
  const persistentBucket = await miniflare.getR2Bucket("BUCKET");
  assert.equal((await persistentBucket.list()).objects.length, 1);

  console.log("VegWatch local smoke test passed");
} finally {
  await miniflare?.dispose();
  await rm(persistenceRoot, { recursive: true, force: true });
}
