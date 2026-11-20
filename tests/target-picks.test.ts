import assert from "node:assert/strict";
import test from "node:test";
import type { Member, RoomState, TargetPicks } from "../lib/auction";
import type { TargetPicksAction } from "../lib/target-picks";

const { AuctionError, createDemoState, createRoomState }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { ownTargetPicks, validateTargetPicks }: typeof import("../lib/target-picks") = await import(new URL("../lib/target-picks.ts", import.meta.url).href);
const managerId = "demo-rcb";
function fixture() {
  const members = createDemoState().members;
  const state = createRoomState("TARGET", "Private research", members[0]);
  state.members = members;
  return { state, member: state.members.find(member => member.id === managerId)! };
}
const save = (playerIds: string[], expectedRevision = 0): TargetPicksAction => ({ type: "set_target_picks", teamId: "rcb", playerIds, expectedRevision });
const rejects = (state: RoomState, member: Member, action: unknown, status: number, code?: string, previous?: TargetPicks) => {
  const before = structuredClone(state);
  assert.throws(() => validateTargetPicks(state, member, action as TargetPicksAction, previous ? { [member.id]: previous } : undefined), (error: unknown) => {
    assert.ok(error instanceof AuctionError);
    assert.equal(error.status, status);
    if (code) assert.equal(error.code, code);
    return true;
  });
  assert.deepEqual(state, before, "rejected target changes leave the auction untouched");
};

test("only a real team manager receives their private list; the projection is a copy", () => {
  const { state, member } = fixture();
  const own = { teamId: "rcb", playerIds: [state.players[0].id], revision: 4 };
  const privatePicks = { [member.id]: own, "demo-csk": { teamId: "csk", playerIds: [state.players[1].id], revision: 8 } };
  const result = ownTargetPicks(state, member.id, privatePicks)!;
  assert.deepEqual(result, own);
  result.playerIds.push("mutation");
  assert.equal(own.playerIds.length, 1);
  assert.equal(ownTargetPicks(state, state.hostId, privatePicks), undefined);
  assert.equal(ownTargetPicks(state, "missing-member", privatePicks), undefined);
  member.role = "spectator";
  assert.equal(ownTargetPicks(state, member.id, privatePicks), undefined);
  member.role = "bidder"; member.teamId = "mi";
  assert.deepEqual(ownTargetPicks(state, member.id, privatePicks), { teamId: "mi", playerIds: [], revision: 0 });
  member.teamId = "missing-team";
  assert.equal(ownTargetPicks(state, member.id, privatePicks), undefined);
});

test("target selections can grow from five to nine to twelve, up to the whole pool, without mutating shared state", () => {
  const { state, member } = fixture();
  const before = structuredClone(state);
  const ids = state.players.map(player => player.id);
  let previous: TargetPicks | undefined;
  for (const count of [5, 9, 12, ids.length, 0]) {
    const requested = ids.slice(0, count);
    previous = validateTargetPicks(state, member, save(requested, previous?.revision ?? 0), previous ? { [member.id]: previous } : undefined);
    assert.deepEqual(previous.playerIds, requested);
    requested.push("caller-mutation");
    assert.equal(previous.playerIds.length, count);
  }
  assert.equal(previous!.revision, 5);
  assert.deepEqual(state, before);
});

test("target editing is independent of the auction phase, including unsold and current players", () => {
  const { state, member } = fixture();
  const first = state.players[0];
  first.status = "unsold"; state.currentPlayerId = first.id;
  for (const phase of ["waiting", "live", "paused", "locked", "sold", "unsold"] as const) {
    state.phase = phase;
    assert.deepEqual(validateTargetPicks(state, member, save([first.id])).playerIds, [first.id]);
  }
});

test("sold, archived and removed players cannot become new targets; existing targets can remain or be removed", () => {
  const { state, member } = fixture();
  const [sold, archived, removed] = state.players;
  sold.status = "sold"; sold.soldTo = "csk";
  archived.catalogArchived = true;
  state.players = state.players.filter(player => player.id !== removed.id);
  const ids = [sold.id, archived.id, removed.id];
  for (const id of ids) rejects(state, member, save([id]), 409, "TARGET_UNAVAILABLE");
  const previous = { teamId: "rcb", playerIds: ids, revision: 3 };
  assert.deepEqual(validateTargetPicks(state, member, save(ids, 3), { [member.id]: previous }), { ...previous, revision: 4 });
  assert.deepEqual(validateTargetPicks(state, member, save([], 3), { [member.id]: previous }).playerIds, []);
});

test("ownership, revision checks and malformed selections cannot be bypassed", () => {
  const { state, member } = fixture();
  const first = state.players[0].id;
  for (const playerIds of [null, undefined, {}, "wrong", [null], [false], [1], [""], ["a".repeat(201)], [first, first]]) {
    rejects(state, member, { ...save([]), playerIds }, 400);
  }
  for (const expectedRevision of [undefined, null, "0", -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    rejects(state, member, { ...save([]), expectedRevision }, 400);
  }
  rejects(state, member, save([], 0), 409, "TARGET_PICKS_CONFLICT", { teamId: "rcb", playerIds: [first], revision: 1 });
  rejects(state, member, { ...save([]), teamId: "csk" }, 403, "FORBIDDEN");
  const host = state.members.find(entry => entry.id === state.hostId)!;
  host.teamId = "rcb";
  rejects(state, host, save([]), 403, "FORBIDDEN");
  member.role = "spectator";
  rejects(state, member, save([]), 403, "FORBIDDEN");
});

test("each first choice can save one optional private backup and independent budgets", () => {
  const { state, member } = fixture();
  const [first, backup, standalone] = state.players.filter(player => player.eligibilityVerified !== false);
  const action = { ...save([first.id, standalone.id]), backups: { [first.id]: backup.id }, maxBids: { [first.id]: 525, [backup.id]: 350 } };
  const before = structuredClone(state);
  const saved = validateTargetPicks(state, member, action);
  assert.deepEqual(saved.backups, action.backups);
  assert.deepEqual(saved.maxBids, action.maxBids);
  assert.deepEqual(saved.playerIds, [first.id, standalone.id], "the backup is not a second first choice");
  const projection = ownTargetPicks(state, member.id, { [member.id]: saved })!;
  projection.backups![first.id] = "caller-mutation";
  projection.maxBids![backup.id] = 1;
  assert.equal(saved.backups![first.id], backup.id);
  assert.equal(saved.maxBids![backup.id], 350);
  assert.deepEqual(state, before);
  assert.equal(ownTargetPicks(state, state.hostId, { [member.id]: saved }), undefined);
  assert.deepEqual(ownTargetPicks(state, "demo-csk", { [member.id]: saved }), { teamId: "csk", playerIds: [], revision: 0 });
});

test("backup pairs reject self links, shared backups, nested chains, cycles and malformed maps", () => {
  const { state, member } = fixture();
  const [a, b, c] = state.players.filter(player => player.eligibilityVerified !== false).map(player => player.id);
  const invalid = [null, false, "backup", [], new Date(), Object.create({ [a]: c }),
    { [a]: a }, { [a]: b }, { [a]: b, [b]: a }, { [a]: b, [b]: c }, { [a]: c, [b]: c },
    { absent: c }, { [a]: [] }, { [a]: null }, { [a]: "" }, { [a]: "x".repeat(201) },
    { [a]: "constructor" }, JSON.parse(`{"__proto__":"${c}"}`),
  ];
  for (const backups of invalid) rejects(state, member, { ...save([a, b]), backups }, 400, "INVALID_TARGET_BACKUP");
});

test("new backups must be eligible but existing unavailable pairs remain readable and removable", () => {
  const { state, member } = fixture();
  const [first, backup] = state.players.filter(player => player.eligibilityVerified !== false);
  const action = { ...save([first.id]), backups: { [first.id]: backup.id } };
  const previous = validateTargetPicks(state, member, action);
  for (const patch of [{ status: "sold", soldTo: "csk" }, { status: "unsold", catalogArchived: true }, { catalogArchived: false, eligibilityVerified: false }] as const) {
    Object.assign(backup, patch);
    rejects(state, member, action, 409, "TARGET_UNAVAILABLE");
    const kept = validateTargetPicks(state, member, { ...action, expectedRevision: previous.revision }, { [member.id]: previous });
    assert.deepEqual(kept.backups, previous.backups);
  }
  state.players = state.players.filter(player => player.id !== backup.id);
  rejects(state, member, action, 409, "TARGET_UNAVAILABLE");
  assert.deepEqual(validateTargetPicks(state, member, save([first.id], 1), { [member.id]: previous }).backups, previous.backups);
  const cleared = validateTargetPicks(state, member, { ...save([first.id], 1), backups: {} }, { [member.id]: previous });
  assert.equal(Object.hasOwn(cleared, "backups"), false);
});

test("legacy saves preserve surviving pairs and limits while removals or promotions prune obsolete data", () => {
  const { state, member } = fixture();
  const [a, b, c] = state.players.filter(player => player.eligibilityVerified !== false).map(player => player.id);
  const previous = validateTargetPicks(state, member, { ...save([a, c]), backups: { [a]: b }, maxBids: { [a]: 500, [b]: 350, [c]: 700 } });
  const kept = validateTargetPicks(state, member, save([a], 1), { [member.id]: previous });
  assert.deepEqual(kept.backups, { [a]: b });
  assert.deepEqual(kept.maxBids, { [a]: 500, [b]: 350 });
  const unlinked = validateTargetPicks(state, member, { ...save([a], 2), backups: {} }, { [member.id]: kept });
  assert.equal(unlinked.backups, undefined);
  assert.deepEqual(unlinked.maxBids, { [a]: 500 });
  const removed = validateTargetPicks(state, member, save([c], 1), { [member.id]: previous });
  assert.equal(removed.backups, undefined);
  assert.deepEqual(removed.maxBids, { [c]: 700 });
  const promoted = validateTargetPicks(state, member, save([a, b], 1), { [member.id]: previous });
  assert.equal(promoted.backups, undefined);
  assert.deepEqual(promoted.maxBids, { [a]: 500, [b]: 350 });
});

test("backup changes share owner authorization and revisions and remain read-only after completion", () => {
  const { state, member } = fixture();
  const [a, b, c] = state.players.filter(player => player.eligibilityVerified !== false).map(player => player.id);
  const action = { ...save([a]), backups: { [a]: b } };
  const previous = validateTargetPicks(state, member, action);
  rejects(state, member, { ...action, backups: { [a]: c } }, 409, "TARGET_PICKS_CONFLICT", previous);
  rejects(state, member, { ...action, teamId: "csk", expectedRevision: 1 }, 403, "FORBIDDEN", previous);
  rejects(state, state.members[0], action, 403, "FORBIDDEN");
  member.role = "spectator";
  rejects(state, member, action, 403, "FORBIDDEN", previous);
  member.role = "bidder";
  state.endedAt = Date.now();
  rejects(state, member, { ...action, expectedRevision: 1, backups: {} }, 409, "AUCTION_ENDED", previous);
  assert.deepEqual(ownTargetPicks(state, member.id, { [member.id]: previous }), previous);
});
