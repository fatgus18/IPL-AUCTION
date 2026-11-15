import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { databaseConfig } from "../scripts/init-db.mjs";

test("Turso Marketplace variables configure a hosted database on Vercel", () => {
  assert.deepEqual(databaseConfig({
    VERCEL: "1", TURSO_DATABASE_URL: " libsql://marketplace.turso.io ", TURSO_AUTH_TOKEN: " test-cloud-token ",
  }), { url: "libsql://marketplace.turso.io", filePath: undefined, authToken: "test-cloud-token" });
});

test("explicit database variables take precedence over Marketplace variables", () => {
  assert.deepEqual(databaseConfig({
    VERCEL: "1", DATABASE_URL: "libsql://preferred.turso.io", DATABASE_AUTH_TOKEN: "test-preferred-token",
    TURSO_DATABASE_URL: "libsql://marketplace.turso.io", TURSO_AUTH_TOKEN: "test-cloud-token",
  }), { url: "libsql://preferred.turso.io", filePath: undefined, authToken: "test-preferred-token" });
});

test("blank legacy variables permit Marketplace configuration", () => {
  assert.deepEqual(databaseConfig({
    VERCEL: "1", DATABASE_URL: " ", DATABASE_AUTH_TOKEN: " ",
    TURSO_DATABASE_URL: "libsql://marketplace.turso.io", TURSO_AUTH_TOKEN: "test-cloud-token",
  }), { url: "libsql://marketplace.turso.io", filePath: undefined, authToken: "test-cloud-token" });
});

test("local development defaults to the existing SQLite database", () => {
  const filePath = resolve(".data/pavilion.db");
  assert.deepEqual(databaseConfig({}), { url: pathToFileURL(filePath).href, filePath, authToken: undefined });
});

test("local files never receive hosted database credentials", () => {
  const filePath = resolve(".data/config-test.db");
  const config = databaseConfig({
    DATABASE_URL: "file:./.data/config-test.db", DATABASE_AUTH_TOKEN: "test-preferred-token",
    TURSO_DATABASE_URL: "libsql://marketplace.turso.io", TURSO_AUTH_TOKEN: "test-cloud-token",
  });
  assert.deepEqual(config, { url: pathToFileURL(filePath).href, filePath, authToken: undefined });
  assert.equal(databaseConfig({ TURSO_DATABASE_URL: "file:./.data/config-test.db", TURSO_AUTH_TOKEN: "test-cloud-token" }).authToken, undefined);
});

test("Vercel rejects missing or blank hosted database URLs", () => {
  for (const env of [{ VERCEL: "1" }, { VERCEL: "1", DATABASE_URL: " ", TURSO_DATABASE_URL: " " }]) {
    assert.throws(() => databaseConfig(env), /Vercel requires a persistent hosted/);
  }
});

test("Vercel rejects file URLs from either setting, including an explicit local override", () => {
  for (const env of [
    { VERCEL: "1", DATABASE_URL: "file:./.data/pavilion.db" },
    { VERCEL: "1", TURSO_DATABASE_URL: "file:./.data/pavilion.db" },
    { VERCEL: "1", DATABASE_URL: "file:./.data/pavilion.db", TURSO_DATABASE_URL: "libsql://marketplace.turso.io" },
  ]) assert.throws(() => databaseConfig(env), /Vercel requires a persistent hosted/);
});
