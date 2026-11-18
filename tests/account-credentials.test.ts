import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { decryptRoomCredential, encryptRoomCredential } from "../lib/account-credentials.ts";

const secret = randomBytes(32).toString("hex");
const token = randomBytes(32).toString("hex");
const owner = { userId: "account-owner", roomCode: "ABCD23", memberId: "room-owner" };

test("saved room credentials retain the original capability with randomized authenticated encryption", () => {
  const first = encryptRoomCredential(token, owner, secret);
  const second = encryptRoomCredential(token, owner, secret);
  assert.notEqual(first, second);
  assert.ok(!first.includes(token));
  assert.equal(decryptRoomCredential(first, owner, secret), token);
  assert.equal(decryptRoomCredential(second, owner, secret), token);
});

test("encrypted room credentials cannot be copied to another account, room or member", () => {
  const encrypted = encryptRoomCredential(token, owner, secret);
  for (const changed of [{ ...owner, userId: "another-user" }, { ...owner, roomCode: "OTHER2" }, { ...owner, memberId: "another-member" }]) {
    assert.throws(() => decryptRoomCredential(encrypted, changed, secret));
  }
  assert.throws(() => decryptRoomCredential(encrypted, owner, randomBytes(32).toString("hex")));
});

test("modified ciphertext and malformed envelopes are rejected", () => {
  const encrypted = encryptRoomCredential(token, owner, secret);
  const parts = encrypted.split(".");
  const payload = Buffer.from(parts[3], "base64url");
  payload[0] ^= 1; parts[3] = payload.toString("base64url");
  assert.throws(() => decryptRoomCredential(parts.join("."), owner, secret));
  for (const malformed of ["", "v1", encrypted + ".extra", encrypted.replace(/^v1/, "v2")]) {
    assert.throws(() => decryptRoomCredential(malformed, owner, secret));
  }
});
