import assert from "node:assert/strict";
import test from "node:test";

const { requestAuction, AuctionRequestError }: typeof import("../lib/auction-client") =
  await import(new URL("../lib/auction-client.ts", import.meta.url).href);

const PATH = "/api/auction/rooms/OPTIONS26";

function requestError(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof AuctionRequestError);
    assert.equal(error.code, code);
    return true;
  };
}

test("an already-cancelled request never invokes fetch or sends a mutation", async t => {
  const controller = new AbortController();
  controller.abort();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ accepted: true }));
  await assert.rejects(requestAuction(PATH, { type: "bid" }, undefined, { signal: controller.signal }), requestError("REQUEST_ABORTED"));
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("caller cancellation settles an unresponsive request immediately without retrying", async t => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  const fetchMock = t.mock.method(globalThis, "fetch", async (_path: string | URL | Request, init?: RequestInit) => {
    requestSignal = init?.signal;
    return new Promise<Response>(() => {});
  });
  const request = requestAuction(PATH, { type: "bid" }, undefined, { signal: controller.signal });
  const rejected = assert.rejects(request, requestError("REQUEST_ABORTED"));
  assert.equal(requestSignal?.aborted, false);
  controller.abort();
  await rejected;
  assert.equal(requestSignal?.aborted, true);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("caller cancellation also settles a request whose response body is stalled", async t => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  const response = new Response(new ReadableStream({ start() {} }), { headers: { "Content-Type": "application/json" } });
  const fetchMock = t.mock.method(globalThis, "fetch", async (_path: string | URL | Request, init?: RequestInit) => {
    requestSignal = init?.signal;
    return response;
  });
  const request = requestAuction(PATH, undefined, undefined, { signal: controller.signal });
  const rejected = assert.rejects(request, requestError("REQUEST_ABORTED"));
  await Promise.resolve();
  controller.abort();
  await rejected;
  assert.equal(requestSignal?.aborted, true);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("a completed request detaches cancellation and clears its deadline", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", async (_path: string | URL | Request, init?: RequestInit) => {
    requestSignal = init?.signal;
    return Response.json({ accepted: true });
  });
  assert.deepEqual(await requestAuction(PATH, undefined, undefined, { signal: controller.signal, timeoutMs: 1000 }), { accepted: true });
  controller.abort();
  t.mock.timers.tick(45000);
  assert.equal(requestSignal?.aborted, false, "later cancellation or stale deadlines must not affect a completed request");
});

for (const [label, timeoutMs, expectedDeadline] of [
  ["an extended lookup deadline", 30000, 30000],
  ["a timeout below the supported minimum", 0, 1000],
  ["a timeout above the supported maximum", 90000, 45000],
] as const) {
  test(`${label} aborts at the configured bounded deadline`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let requestSignal: AbortSignal | null | undefined;
    const fetchMock = t.mock.method(globalThis, "fetch", async (_path: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal;
      return new Promise<Response>(() => {});
    });
    const request = requestAuction(PATH, undefined, undefined, { timeoutMs });
    const rejected = assert.rejects(request, requestError("REQUEST_TIMEOUT"));
    t.mock.timers.tick(expectedDeadline - 1);
    assert.equal(requestSignal?.aborted, false);
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(requestSignal?.aborted, true);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

for (const timeoutMs of [NaN, Infinity, -Infinity]) {
  test(`a nonfinite timeout (${String(timeoutMs)}) uses a safe default deadline`, async t => {
    // Inspect the scheduled delay because timer runtimes handle NaN differently;
    // passing nonfinite delays to any runtime is itself the regression.
    const timer = t.mock.method(globalThis, "setTimeout");
    t.mock.method(globalThis, "fetch", async () => Response.json({ accepted: true }));
    await requestAuction(PATH, undefined, undefined, { timeoutMs });
    assert.equal(timer.mock.callCount(), 1);
    assert.equal(timer.mock.calls[0].arguments[1], 15000);
  });
}
