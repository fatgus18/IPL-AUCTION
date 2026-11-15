import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { createTeamAccess, deriveTeamPassword, matchesTeamPassword } from "../lib/room-access.ts";

test("team passwords are recoverable only using the creator's credential and the correct room", () => {
  const hostToken = randomBytes(32).toString("hex");
  const credential = createTeamAccess(hostToken, "ROOM01");
  const password = deriveTeamPassword(hostToken, "ROOM01", credential.salt);
  assert.match(password, /^[A-Za-z0-9_-]{20}$/);
  assert.equal(deriveTeamPassword(hostToken, "ROOM01", credential.salt), password);
  assert.equal(matchesTeamPassword(credential, password), true);
  assert.equal(matchesTeamPassword(credential, ` ${password} `), true, "pasting with surrounding whitespace is safe");
  assert.notEqual(deriveTeamPassword(hostToken, "ROOM02", credential.salt), password);
  assert.notEqual(deriveTeamPassword(randomBytes(32).toString("hex"), "ROOM01", credential.salt), password);
  assert.equal(matchesTeamPassword(credential, deriveTeamPassword(hostToken, "ROOM02", credential.salt)), false);
  assert.equal(credential.passwordHash, createHash("sha256").update(password).digest("hex"));
  assert.deepEqual(Object.keys(credential).sort(), ["passwordHash", "salt"]);
  assert.ok(!JSON.stringify(credential).includes(password));
  assert.ok(!JSON.stringify(credential).includes(hostToken));
});

test("independently initialized room access has fresh passwords even for the same creator and room", () => {
  const hostToken = randomBytes(32).toString("hex");
  const first = createTeamAccess(hostToken, "ROOM01");
  const second = createTeamAccess(hostToken, "ROOM01");
  assert.notEqual(first.salt, second.salt);
  const firstPassword = deriveTeamPassword(hostToken, "ROOM01", first.salt);
  const secondPassword = deriveTeamPassword(hostToken, "ROOM01", second.salt);
  assert.notEqual(firstPassword, secondPassword);
  assert.equal(matchesTeamPassword(first, secondPassword), false);
});

test("malformed or incorrect team passwords and invalid stored digests are rejected without throwing", () => {
  const hostToken = randomBytes(32).toString("hex");
  const credential = createTeamAccess(hostToken, "ROOM01");
  const password = deriveTeamPassword(hostToken, "ROOM01", credential.salt);
  for (const candidate of [undefined, null, 123, {}, [], "", " ", password.slice(1), `${password}x`, "x".repeat(512), "*".repeat(20)]) {
    assert.equal(matchesTeamPassword(credential, candidate), false);
  }
  const changed = `${password[0] === "a" ? "b" : "a"}${password.slice(1)}`;
  assert.equal(matchesTeamPassword(credential, changed), false);
  for (const invalidHash of ["", "a", "z".repeat(64), "a".repeat(62)]) {
    assert.equal(matchesTeamPassword({ ...credential, passwordHash: invalidHash }, password), false);
  }
});
