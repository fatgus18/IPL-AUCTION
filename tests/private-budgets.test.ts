import assert from "node:assert/strict";
import test from "node:test";
import type { TargetPicks } from "../lib/auction";
import type { TargetPicksAction } from "../lib/target-picks";

const { AuctionError, createDemoState, createRoomState }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { ownTargetPicks, validateTargetPicks }: typeof import("../lib/target-picks") = await import(new URL("../lib/target-picks.ts", import.meta.url).href);
function fixture() {
  const members = createDemoState().members;
  const state = createRoomState("BUDGET", "Private plans", members[0]);
  state.members = members;
  const member = members.find(entry => entry.id === "demo-rcb")!;
  const ids = state.players.slice(0, 3).map(player => player.id);
  const action: TargetPicksAction = { type: "set_target_picks", teamId: "rcb", playerIds: ids, expectedRevision: 0 };
  const validate = (patch: Partial<TargetPicksAction> = {}, previous?: TargetPicks) => validateTargetPicks(state, member, { ...action, ...patch }, previous ? { [member.id]: previous } : undefined);
  return { state, member, ids, action, validate };
}
const code = (expected: string) => (error: unknown) => error instanceof AuctionError && error.code === expected;

test("private budgets accept independent whole-lakh limits without changing any auction values", () => {
  const { state, ids, validate } = fixture();
  const before = structuredClone(state);
  const maxBids = { [ids[0]]: 1, [ids[1]]: 100000 };
  const result = validate({ maxBids });
  assert.deepEqual(result.maxBids, maxBids);
  assert.ok(result.maxBids![ids[0]] < state.players[0].basePrice, "a planning limit can be below the opening price");
  assert.ok(result.maxBids![ids[1]] > state.teams[0].purse, "planning is not a purse reservation");
  maxBids[ids[0]] = 900;
  assert.equal(result.maxBids![ids[0]], 1);
  assert.deepEqual(state, before);
});

test("old list-only clients preserve surviving budgets; deleting targets prunes their limits", () => {
  const { ids, validate } = fixture();
  const saved = validate({ maxBids: { [ids[0]]: 350, [ids[1]]: 700 } });
  const kept = validate({ playerIds: [ids[1], ids[2]], expectedRevision: saved.revision }, saved);
  assert.deepEqual(kept.maxBids, { [ids[1]]: 700 });
  const cleared = validate({ playerIds: [], expectedRevision: kept.revision }, kept);
  assert.equal(Object.hasOwn(cleared, "maxBids"), false);
});

test("deployed clients sending first-choice budgets preserve unseen backup limits", () => {
  const { ids: [first, backup, standalone], validate } = fixture();
  const saved = validate({ playerIds: [first, standalone], backups: { [first]: backup }, maxBids: { [first]: 500, [backup]: 350, [standalone]: 800 } });
  // This is the deployed UI payload: explicit first-choice maxBids, no backups.
  const legacyEdit = { playerIds: [first, standalone], maxBids: { [first]: 575 }, expectedRevision: saved.revision };
  const edited = validate(legacyEdit, saved);
  assert.deepEqual(edited.backups, { [first]: backup });
  assert.deepEqual(edited.maxBids, { [first]: 575, [backup]: 350 }, "the primary edit and explicit removal apply while the unseen backup limit survives");
  const clearedPrimaries = validate({ playerIds: [first, standalone], maxBids: {}, expectedRevision: edited.revision }, edited);
  assert.deepEqual(clearedPrimaries.maxBids, { [backup]: 350 });
  const explicitBackupEdit = validate({ playerIds: [first, standalone], maxBids: { [first]: 600, [backup]: 375 }, expectedRevision: saved.revision }, saved);
  assert.deepEqual(explicitBackupEdit.maxBids, { [first]: 600, [backup]: 375 }, "an explicitly supplied backup limit takes precedence over its old value");
  assert.throws(() => validate(legacyEdit, edited), code("TARGET_PICKS_CONFLICT"));
  assert.deepEqual(saved.maxBids, { [first]: 500, [backup]: 350, [standalone]: 800 });
});

test("legacy first-choice removals and backup promotions do not retain obsolete backup limits", () => {
  const { ids: [first, backup, standalone], validate } = fixture();
  const saved = validate({ playerIds: [first, standalone], backups: { [first]: backup }, maxBids: { [first]: 500, [backup]: 350, [standalone]: 800 } });
  const removed = validate({ playerIds: [standalone], maxBids: { [standalone]: 825 }, expectedRevision: saved.revision }, saved);
  assert.equal(removed.backups, undefined);
  assert.deepEqual(removed.maxBids, { [standalone]: 825 }, "removing the chain removes its unseen backup limit too");
  const promoted = validate({ playerIds: [first, backup, standalone], maxBids: { [first]: 575, [standalone]: 825 }, expectedRevision: saved.revision }, saved);
  assert.equal(promoted.backups, undefined);
  assert.deepEqual(promoted.maxBids, { [first]: 575, [standalone]: 825 }, "a promoted backup now follows explicit first-choice budget replacement");
  const promotedWithLimit = validate({ playerIds: [backup, standalone], maxBids: { [backup]: 400, [standalone]: 825 }, expectedRevision: saved.revision }, saved);
  assert.equal(promotedWithLimit.backups, undefined);
  assert.deepEqual(promotedWithLimit.maxBids, { [backup]: 400, [standalone]: 825 });
});

test("clients sending backups can explicitly replace or clear every backup budget", () => {
  const { ids: [first, backup, standalone], validate } = fixture();
  const backups = { [first]: backup };
  const saved = validate({ playerIds: [first, standalone], backups, maxBids: { [first]: 500, [backup]: 350, [standalone]: 800 } });
  const replaced = validate({ playerIds: [first, standalone], backups, maxBids: { [first]: 625 }, expectedRevision: saved.revision }, saved);
  assert.deepEqual(replaced.backups, backups);
  assert.deepEqual(replaced.maxBids, { [first]: 625 });
  const cleared = validate({ playerIds: [first, standalone], backups, maxBids: {}, expectedRevision: saved.revision }, saved);
  assert.deepEqual(cleared.backups, backups);
  assert.equal(cleared.maxBids, undefined);
});

test("an explicit map replaces all previous limits, and an empty map clears them", () => {
  const { ids, validate } = fixture();
  const saved = validate({ maxBids: { [ids[0]]: 500, [ids[1]]: 800 } });
  const replaced = validate({ maxBids: { [ids[2]]: 240 }, expectedRevision: saved.revision }, saved);
  assert.deepEqual(replaced.maxBids, { [ids[2]]: 240 });
  const cleared = validate({ maxBids: {}, expectedRevision: replaced.revision }, replaced);
  assert.equal(Object.hasOwn(cleared, "maxBids"), false);
});

test("budget projections deep-copy the private limit map and omit empty maps", () => {
  const { state, member, ids, validate } = fixture();
  const saved = validate({ maxBids: { [ids[0]]: 650 } });
  const result = ownTargetPicks(state, member.id, { [member.id]: saved })!;
  result.maxBids![ids[0]] = 1;
  result.playerIds.length = 0;
  assert.equal(saved.maxBids![ids[0]], 650);
  assert.equal(saved.playerIds.length, 3);
  assert.equal(ownTargetPicks(state, state.hostId, { [member.id]: saved }), undefined);
  const empty = ownTargetPicks(state, member.id, { [member.id]: { ...saved, maxBids: {} } })!;
  assert.equal(Object.hasOwn(empty, "maxBids"), false);
});

test("malformed maps, unselected keys, decimal and out-of-range amounts are rejected atomically", () => {
  const { state, ids, validate } = fixture();
  const before = structuredClone(state);
  for (const value of [null, false, 500, "500", [], new Date(), Object.create({ [ids[0]]: 500 })]) {
    assert.throws(() => validate({ maxBids: value as unknown as Record<string, number> }), code("INVALID_TARGET_BUDGET"));
  }
  for (const amount of [0, -1, 0.5, 100001, Number.MAX_SAFE_INTEGER, NaN, Infinity, "500", true, null, {}]) {
    assert.throws(() => validate({ maxBids: { [ids[0]]: amount } as Record<string, number> }), code("INVALID_TARGET_BUDGET"));
  }
  assert.throws(() => validate({ maxBids: { unselected: 500 } }), code("INVALID_TARGET_BUDGET"));
  assert.deepEqual(state, before);
});

test("prototype-sensitive budget keys are rejected even if present as selected player IDs", () => {
  const { state, ids, validate } = fixture();
  for (const key of ["__proto__", "constructor", "prototype"]) {
    state.players.push({ ...state.players[0], id: key });
    const maxBids = JSON.parse(`{"${key}":500}`);
    assert.throws(() => validate({ playerIds: [...ids, key], maxBids }), code("INVALID_TARGET_BUDGET"));
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("budget edits share list revisions and cannot overwrite a competing change", () => {
  const { ids, validate } = fixture();
  const saved = validate({ maxBids: { [ids[0]]: 700 } });
  assert.throws(() => validate({ maxBids: { [ids[0]]: 800 }, expectedRevision: 0 }, saved), code("TARGET_PICKS_CONFLICT"));
  assert.deepEqual(saved.maxBids, { [ids[0]]: 700 });
  const updated = validate({ maxBids: { [ids[0]]: 800 }, expectedRevision: 1 }, saved);
  assert.equal(updated.revision, 2);
});

test("another role or franchise cannot read or change a manager's private budgets", () => {
  const { state, member, ids, action, validate } = fixture();
  const saved = validate({ maxBids: { [ids[0]]: 500 } });
  const privatePicks = { [member.id]: saved };
  assert.throws(() => validateTargetPicks(state, state.members[0], action, privatePicks), code("FORBIDDEN"));
  member.role = "spectator";
  assert.equal(ownTargetPicks(state, member.id, privatePicks), undefined);
  assert.throws(() => validateTargetPicks(state, member, action, privatePicks), code("FORBIDDEN"));
  member.role = "bidder"; member.teamId = "mi";
  assert.deepEqual(ownTargetPicks(state, member.id, privatePicks), { teamId: "mi", playerIds: [], revision: 0 });
});

test("ended auctions preserve readable private budgets but refuse edits", () => {
  const { state, member, ids, validate } = fixture();
  const saved = validate({ maxBids: { [ids[0]]: 500 } });
  state.endedAt = Date.now();
  assert.deepEqual(ownTargetPicks(state, member.id, { [member.id]: saved }), saved);
  assert.throws(() => validate({ maxBids: {}, expectedRevision: 1 }, saved), code("AUCTION_ENDED"));
});
