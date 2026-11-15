import assert from "node:assert/strict";
import { test } from "node:test";
import { hasSameRequestOrigin } from "../lib/request-origin.ts";

const request = (origin: string | null, host: string | null = "127.0.0.1:3000", url = "http://localhost:3000/api/players/lookup", forwarded: Record<string, string> = {}) => {
  const headers = new Headers(forwarded);
  if (origin !== null) headers.set("origin", origin);
  if (host !== null) headers.set("host", host);
  return { headers, url };
};

test("browser Origin follows the actual Host when Next reconstructs localhost", () => {
  assert.equal(hasSameRequestOrigin(request("http://127.0.0.1:3000")), true);
  assert.equal(hasSameRequestOrigin(request("http://localhost:3000", "localhost:3000")), true);
  assert.equal(hasSameRequestOrigin(request("http://[::1]:3000", "[::1]:3000")), true);
  assert.equal(hasSameRequestOrigin(request("http://localhost:3000")), false);
});

test("host, port and protocol must all match", () => {
  for (const origin of ["http://attacker.test:3000", "http://127.0.0.1:3001", "https://127.0.0.1:3000", "http://127.0.0.1", "http://127.0.0.1.attacker.test:3000"]) {
    assert.equal(hasSameRequestOrigin(request(origin)), false, origin);
  }
  assert.equal(hasSameRequestOrigin(request("https://auction.example", "auction.example", "https://internal.example/api/players/lookup")), true);
});

test("canonical origins normalize hostname case and explicit default ports", () => {
  assert.equal(hasSameRequestOrigin(request("HTTP://AUCTION.EXAMPLE:80", "auction.example", "http://localhost/api/players/lookup")), true);
  assert.equal(hasSameRequestOrigin(request("https://auction.example", "AUCTION.EXAMPLE:443", "https://localhost/api/players/lookup")), true);
});

test("opaque and malformed Origins and Hosts are rejected", () => {
  for (const origin of ["", "null", "127.0.0.1:3000", "ftp://127.0.0.1:3000", "http://127.0.0.1:3000/", "http://127.0.0.1:3000/path", "http://127.0.0.1:3000?x=1", "http://127.0.0.1:3000#fragment", "http://user@127.0.0.1:3000", "http://@127.0.0.1:3000", "http://127.0.0.1:3000 http://attacker.test", "http://127.0.0.1:3000,http://attacker.test", "http://127.0.0.1:"]) {
    assert.equal(hasSameRequestOrigin(request(origin)), false, origin);
  }
  for (const host of [null, "", "127.0.0.1:3000/path", "user@127.0.0.1:3000", "127.0.0.1:", "127.0.0.1:99999", "127.0.0.1:3000,attacker.test", "127.0.0.1:3000?x=1"]) {
    assert.equal(hasSameRequestOrigin(request("http://127.0.0.1:3000", host)), false, String(host));
  }
});

test("untrusted forwarded headers cannot change the allowed origin", () => {
  const forwarded = { "x-forwarded-host": "attacker.test", "x-forwarded-proto": "https", forwarded: "host=attacker.test;proto=https" };
  assert.equal(hasSameRequestOrigin(request("http://127.0.0.1:3000", "127.0.0.1:3000", undefined, forwarded)), true);
  assert.equal(hasSameRequestOrigin(request("https://attacker.test", "127.0.0.1:3000", undefined, forwarded)), false);
  assert.equal(hasSameRequestOrigin(request("https://127.0.0.1:3000", "127.0.0.1:3000", undefined, forwarded)), false);
});

test("tools without an Origin header remain allowed", () => {
  assert.equal(hasSameRequestOrigin(request(null)), true);
  assert.equal(hasSameRequestOrigin(request(null, null)), true);
});
