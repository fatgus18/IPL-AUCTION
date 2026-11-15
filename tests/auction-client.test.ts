import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

const { requestAuction, AuctionRequestError }: typeof import("../lib/auction-client") =
  await import(new URL("../lib/auction-client.ts", import.meta.url).href);

function mockFetch(t: TestContext, implementation: typeof fetch) {
  return t.mock.method(globalThis, "fetch", implementation);
}

function hasRequestError(status: number | undefined, code: string, message?: string) {
  return (error: unknown) => {
    assert.ok(error instanceof AuctionRequestError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    if (message) assert.equal(error.message, message);
    assert.doesNotMatch(error.message, /<!DOCTYPE|<html|private-secret|Unexpected token|SyntaxError|stack trace/i);
    return true;
  };
}

test("accepts JSON and preserves POST body, authentication, and uncached request options", async (t) => {
  const payload = { state: { code: "TEST26" }, token: "new-token", memberId: "new-member" };
  const fetchMock = mockFetch(t, async (path, init) => {
    assert.equal(path, "/api/auction/rooms/TEST26/join");
    assert.equal(init?.method, "POST");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.body, JSON.stringify({ name: "Guest", teamId: "rcb" }));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.get("accept"), "application/json");
    assert.equal(headers.get("authorization"), "Bearer previous-token");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(init.signal.aborted, false);
    return Response.json(payload);
  });
  assert.deepEqual(await requestAuction("/api/auction/rooms/TEST26/join", { name: "Guest", teamId: "rcb" }, "previous-token"), payload);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("uses GET without a body or bearer header when neither is supplied", async (t) => {
  mockFetch(t, async (_path, init) => {
    assert.equal(init?.method, "GET");
    assert.equal(init?.body, undefined);
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    return new Response('{"state":{}}', { headers: { "Content-Type": "Application/JSON; charset=utf-8" } });
  });
  assert.deepEqual(await requestAuction("/api/auction/rooms/TEST26"), { state: {} });
});

test("accepts application/*+json responses", async (t) => {
  mockFetch(t, async () => new Response('{"state":{}}', { headers: { "Content-Type": "application/vnd.pavilion+json" } }));
  assert.deepEqual(await requestAuction("/api/auction/rooms/TEST26"), { state: {} });
});

test("preserves actionable JSON API errors and does not retry a rejected join", async (t) => {
  const message = "This team already has a manager. Choose another team or join as a spectator.";
  const fetchMock = mockFetch(t, async () => Response.json({ error: message, code: "TEAM_TAKEN" }, { status: 409 }));
  await assert.rejects(requestAuction("/api/auction/rooms/TEST26/join", { teamId: "rcb" }), hasRequestError(409, "TEAM_TAKEN", message));
  assert.equal(fetchMock.mock.callCount(), 1);
});

for (const status of [404, 500, 200]) {
  test(`handles HTML HTTP ${status} without showing markup or a JSON parser exception`, async (t) => {
    const fetchMock = mockFetch(t, async () => new Response("<!DOCTYPE html><html>private-secret</html>", { status, headers: { "Content-Type": "text/html" } }));
    await assert.rejects(requestAuction("/api/auction/rooms/TEST26/join", { name: "Guest" }), hasRequestError(status, "INVALID_RESPONSE"));
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

for (const [description, body] of [
  ["malformed JSON", '{"state":'],
  ["HTML mislabeled as JSON", "<!DOCTYPE html><html>private-secret</html>"],
  ["empty JSON", ""],
  ["null", "null"],
  ["an array", "[]"],
  ["a string", '"private-secret"'],
  ["a number", "42"],
]) {
  test(`rejects ${description} even when the response is successful`, async (t) => {
    mockFetch(t, async () => new Response(body, { headers: { "Content-Type": "application/json" } }));
    await assert.rejects(requestAuction("/api/auction/rooms/TEST26"), hasRequestError(200, "INVALID_RESPONSE"));
  });
}

test("does not expose HTML, stack traces, or credentials supplied as JSON errors", async (t) => {
  for (const error of ["<html>private-secret</html>", "Error: private-secret\n at handler (app.ts:1:1)", "Bearer private-secret", "token=private-secret"]) {
    mockFetch(t, async () => Response.json({ error }, { status: 500 }));
    await assert.rejects(requestAuction("/api/auction/rooms/TEST26"), hasRequestError(500, "HTTP_ERROR"));
  }
});

test("reports a network interruption as unconfirmed and never replays a mutation", async (t) => {
  const fetchMock = mockFetch(t, async () => { throw new TypeError("private-secret"); });
  await assert.rejects(requestAuction("/api/auction/rooms/TEST26/join", { name: "Guest" }), (error: unknown) => {
    hasRequestError(undefined, "NETWORK_ERROR")(error);
    assert.match((error as Error).message, /couldn't confirm.*Check your room before trying again/);
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("reports native timeout errors without leaking their messages or retrying", async (t) => {
  const fetchMock = mockFetch(t, async () => { throw new DOMException("private-secret", "TimeoutError"); });
  await assert.rejects(requestAuction("/api/auction/rooms/TEST26/join", { name: "Guest" }), hasRequestError(undefined, "REQUEST_TIMEOUT"));
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("aborts and settles an unresponsive request at 15 seconds without retrying", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | null | undefined;
  const fetchMock = mockFetch(t, async (_path, init) => {
    signal = init?.signal;
    return new Promise<Response>(() => {});
  });
  const result = requestAuction("/api/auction/rooms/TEST26/join", { name: "Guest" });
  const rejected = assert.rejects(result, hasRequestError(undefined, "REQUEST_TIMEOUT"));
  t.mock.timers.tick(14_999);
  assert.equal(signal?.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(signal?.aborted, true);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("the same 15-second deadline also bounds a stalled response body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const response = new Response(new ReadableStream({ start() {} }), { headers: { "Content-Type": "application/json" } });
  const fetchMock = mockFetch(t, async () => response);
  const result = requestAuction("/api/auction/rooms/TEST26/join", { name: "Guest" });
  const rejected = assert.rejects(result, hasRequestError(200, "REQUEST_TIMEOUT"));
  await Promise.resolve();
  t.mock.timers.tick(15_000);
  await rejected;
  assert.equal(fetchMock.mock.callCount(), 1);
});
