import assert from "node:assert/strict";
import test from "node:test";
import type { AuctionAction, RoomState, TeamLineupInput } from "../lib/auction";

const { applyAction, AuctionError, createDemoState, createRoomState }:
  typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);

const NOW = 1_800_000_000_000;
const managerId = "demo-rcb";
const empty = (): TeamLineupInput => ({ playingXI: [], substitutes: [], captainId: null, viceCaptainId: null });
const getTeam = (state: RoomState) => state.teams.find(team => team.id === "rcb")!;
const ids = (state: RoomState) => getTeam(state).squad.map(sale => sale.playerId);
const save = (lineup: TeamLineupInput, expectedRevision = 0): AuctionAction => ({ type: "set_lineup", teamId: "rcb", lineup, expectedRevision });
const captaincy = (captainId: string | null, viceCaptainId: string | null, expectedRevision = 0): AuctionAction => ({ type: "set_captaincy", teamId: "rcb", captainId, viceCaptainId, expectedRevision });
const act = (room: RoomState, action: AuctionAction, member = managerId) => applyAction(room, action, member, NOW);

function roomWithPurchases(count = 18): RoomState {
  const members = createDemoState().members;
  const room = createRoomState("LINEUP", "Lineup test", members[0], NOW);
  room.members = [...members, { id: "spectator", name: "Viewer", role: "spectator", teamId: null, joinedAt: NOW, lastSeenAt: NOW, flagRaisedAt: null }];
  const team = getTeam(room);
  for (const player of room.players.slice(0, count)) {
    player.status = "sold"; player.soldTo = team.id; player.soldFor = player.basePrice;
    team.squad.push({ playerId: player.id, amount: player.basePrice });
    team.purse -= player.basePrice;
  }
  return room;
}

function rejects(room: RoomState, action: unknown, status: number, code?: string, member = managerId) {
  const before = structuredClone(room);
  assert.throws(() => act(room, action as AuctionAction, member), (error: unknown) => {
    assert.ok(error instanceof AuctionError);
    assert.equal(error.status, status);
    if (code) assert.equal(error.code, code);
    return true;
  });
  assert.deepEqual(room, before, "a rejected draft cannot change room or financial data");
}

test("old rooms without a lineup accept an empty draft at revision zero", () => {
  const room = roomWithPurchases(0);
  assert.equal(getTeam(room).lineup, undefined);
  const result = act(room, save(empty()));
  assert.deepEqual(getTeam(result).lineup, { ...empty(), revision: 1 });
  assert.equal(getTeam(room).lineup, undefined, "the transition is immutable");
});

test("a manager can save an ordered XI and five substitutes with distinct leaders", () => {
  const room = roomWithPurchases();
  const owned = ids(room);
  const draft = { playingXI: owned.slice(0, 11).reverse(), substitutes: owned.slice(11, 16), captainId: owned[4], viceCaptainId: owned[7] };
  const before = structuredClone(room);
  const result = act(room, save(draft));
  assert.deepEqual(getTeam(result).lineup, { ...draft, revision: 1 });
  assert.equal(result.version, room.version + 1);
  assert.equal(getTeam(result).purse, getTeam(room).purse);
  assert.deepEqual(getTeam(result).squad, getTeam(room).squad);
  assert.deepEqual(result.teams.filter(team => team.id !== "rcb"), room.teams.filter(team => team.id !== "rcb"));
  assert.deepEqual(result.players, room.players);
  assert.deepEqual(result.bidHistory, room.bidHistory);
  assert.equal(result.currentPlayerId, room.currentPlayerId);
  assert.equal(result.phase, room.phase);
  assert.deepEqual(room, before);
  draft.playingXI.pop();
  assert.equal(getTeam(result).lineup!.playingXI.length, 11, "the saved state does not retain caller-owned array references");
});

test("lineups allow partial drafts, unassigned leadership and independent substitutions", () => {
  const room = roomWithPurchases();
  const owned = ids(room);
  const draft = { playingXI: owned.slice(0, 3), substitutes: owned.slice(3, 5), captainId: null, viceCaptainId: owned[0] };
  const first = act(room, save(draft));
  const second = act(first, save({ ...empty(), substitutes: owned.slice(0, 5) }, 1));
  assert.deepEqual(getTeam(second).lineup, { ...empty(), substitutes: owned.slice(0, 5), revision: 2 });
});

test("position seven and substitute five can be saved before any earlier position", () => {
  const room = roomWithPurchases();
  const [seventh, fifthSub, opener] = ids(room);
  const draft: TeamLineupInput = {
    playingXI: [null, null, null, null, null, null, seventh, null, null, null, null],
    substitutes: [null, null, null, null, fifthSub], captainId: seventh, viceCaptainId: null,
  };
  const first = act(room, save(draft));
  assert.deepEqual(getTeam(first).lineup, { ...draft, playingXI: draft.playingXI.slice(0, 7), revision: 1 });
  const next = { ...getTeam(first).lineup!, playingXI: [opener, null, null, null, null, null, seventh], viceCaptainId: opener };
  const second = act(first, save(next, 1));
  assert.deepEqual(getTeam(second).lineup, { ...next, revision: 2 });
  assert.equal(getTeam(second).lineup!.playingXI[6], seventh, "filling the opener does not shift position seven");
  assert.deepEqual(getTeam(second).lineup!.substitutes, draft.substitutes);
  rejects(second, save(draft, 1), 409, "LINEUP_CONFLICT");
});

test("blank slots are independent, while repeated player IDs and out-of-range positions are rejected", () => {
  const room = roomWithPurchases();
  const [first, second] = ids(room);
  const cleared = act(room, save({ ...empty(), playingXI: Array(11).fill(null), substitutes: Array(5).fill(null) }));
  assert.deepEqual(getTeam(cleared).lineup, { ...empty(), revision: 1 });
  const sparse = { playingXI: [null, first], substitutes: [null, second], captainId: first, viceCaptainId: null };
  assert.deepEqual(getTeam(act(room, save(sparse))).lineup, { ...sparse, revision: 1 });
  rejects(room, save({ ...empty(), playingXI: [first, null, first] }), 400);
  rejects(room, save({ ...empty(), substitutes: [first, null, first] }), 400);
  rejects(room, save({ ...empty(), playingXI: [null, first], substitutes: [null, first] }), 400);
  rejects(room, save({ ...empty(), playingXI: [...Array(11).fill(null), first] }), 400);
  rejects(room, save({ ...empty(), substitutes: [...Array(5).fill(null), first] }), 400);
  assert.equal(getTeam(act(room, save({ ...sparse, captainId: second }))).lineup!.captainId, second);
  rejects(room, save({ ...sparse, viceCaptainId: first }), 400);
});

test("lineup changes require the authenticated manager of the selected team", () => {
  const room = roomWithPurchases();
  rejects(room, save(empty()), 401, "UNAUTHORIZED", "missing-member");
  for (const member of ["demo-host", "spectator", "demo-mi"]) rejects(room, save(empty()), 403, "FORBIDDEN", member);
  rejects(room, { ...save(empty()), teamId: "mi" }, 403, "FORBIDDEN");
  for (const teamId of [null, undefined, 12, {}, ""]) rejects(room, { ...save(empty()), teamId }, 400);
  const corruptHost = structuredClone(room);
  corruptHost.members[0].role = "bidder"; corruptHost.members[0].teamId = "rcb";
  rejects(corruptHost, save(empty()), 403, "FORBIDDEN", "demo-host");
});

test("XI and substitute limits reject oversized selections", () => {
  const room = roomWithPurchases();
  const owned = ids(room);
  rejects(room, save({ ...empty(), playingXI: owned.slice(0, 12) }), 400);
  rejects(room, save({ ...empty(), substitutes: owned.slice(0, 6) }), 400);
});

test("duplicates within and across XI and substitutes are rejected", () => {
  const room = roomWithPurchases();
  const [first] = ids(room);
  rejects(room, save({ ...empty(), playingXI: [first, first] }), 400);
  rejects(room, save({ ...empty(), substitutes: [first, first] }), 400);
  rejects(room, save({ ...empty(), playingXI: [first], substitutes: [first] }), 400);
});

test("lineups cannot include unknown, unpurchased or another team's players", () => {
  const room = roomWithPurchases();
  const available = room.players.find(player => player.status === "available")!;
  for (const playerId of ["not-a-player", available.id]) {
    rejects(room, save({ ...empty(), playingXI: [playerId] }), 400, "LINEUP_PLAYER_NOT_OWNED");
    rejects(room, save({ ...empty(), substitutes: [playerId] }), 400, "LINEUP_PLAYER_NOT_OWNED");
  }
  const otherTeamPlayer = room.players[0];
  otherTeamPlayer.soldTo = "mi";
  rejects(room, save({ ...empty(), playingXI: [otherTeamPlayer.id] }), 400, "LINEUP_PLAYER_NOT_OWNED");
  otherTeamPlayer.soldTo = "rcb"; otherTeamPlayer.status = "unsold";
  rejects(room, save({ ...empty(), playingXI: [otherTeamPlayer.id] }), 400, "LINEUP_PLAYER_NOT_OWNED");
  room.players = room.players.filter(player => player.id !== otherTeamPlayer.id);
  rejects(room, save({ ...empty(), playingXI: [otherTeamPlayer.id] }), 400, "LINEUP_PLAYER_NOT_OWNED");
});

test("captain and vice-captain can be distinct purchased substitutes or reserves", () => {
  const room = roomWithPurchases();
  const [first, sub, reserve] = ids(room);
  const base = { ...empty(), playingXI: [first], substitutes: [sub] };
  assert.deepEqual(getTeam(act(room, save({ ...base, captainId: sub, viceCaptainId: reserve }))).lineup, { ...base, captainId: sub, viceCaptainId: reserve, revision: 1 });
  for (const captainId of ["unknown", ""]) rejects(room, save({ ...base, captainId }), 400);
  for (const viceCaptainId of ["unknown", ""]) rejects(room, save({ ...base, viceCaptainId }), 400);
  rejects(room, save({ ...base, captainId: first, viceCaptainId: first }), 400);
});

test("malformed lineup payloads fail cleanly as client errors", () => {
  const room = roomWithPurchases();
  for (const lineup of [null, undefined, 0, false, "XI", [], {}, { playingXI: [], substitutes: [] }]) rejects(room, { ...save(empty()), lineup }, 400);
  for (const property of ["playingXI", "substitutes"]) {
    for (const value of [null, undefined, "player", {}, 7, [undefined], [0], [{}], [""], ["x".repeat(101)]]) {
      rejects(room, { ...save(empty()), lineup: { ...empty(), [property]: value } }, 400);
    }
  }
  for (const property of ["captainId", "viceCaptainId"]) {
    for (const value of [undefined, {}, [], false, 0]) rejects(room, { ...save(empty()), lineup: { ...empty(), [property]: value } }, 400);
  }
  for (const expectedRevision of [undefined, null, "0", -1, 0.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    rejects(room, { ...save(empty()), expectedRevision }, 400);
  }
});

test("a stale tab cannot silently overwrite a newer saved lineup", () => {
  const room = roomWithPurchases();
  const [first, second] = ids(room);
  const latest = act(room, save({ ...empty(), playingXI: [first] }));
  rejects(latest, save({ ...empty(), playingXI: [second] }), 409, "LINEUP_CONFLICT");
  rejects(latest, save(empty(), 7), 409, "LINEUP_CONFLICT");
  const merged = act(latest, save({ ...empty(), playingXI: [first, second] }, 1));
  assert.deepEqual(getTeam(merged).lineup!.playingXI, [first, second]);
  assert.equal(getTeam(merged).lineup!.revision, 2);
});

test("unrelated auction updates do not invalidate an unchanged lineup revision", () => {
  let room = roomWithPurchases();
  const [first] = ids(room);
  room = act(room, save({ ...empty(), playingXI: [first], captainId: first }));
  room = act(room, { type: "chat", text: "Ready for the next lot" });
  const result = act(room, save({ ...empty(), playingXI: [first] }, 1));
  assert.equal(getTeam(result).lineup!.revision, 2);
});

test("buying another player preserves the saved XI, leadership and revision", () => {
  let room = roomWithPurchases(2);
  const [first, second] = ids(room);
  room = act(room, save({ playingXI: [first, second], substitutes: [], captainId: first, viceCaptainId: second }));
  const saved = structuredClone(getTeam(room).lineup);
  const next = room.players.find(player => player.status === "available" && player.eligibilityVerified !== false && !player.isOverseas)!;
  room = act(room, { type: "select_player", playerId: next.id }, "demo-host");
  room = act(room, { type: "start" }, "demo-host");
  room = act(room, { type: "bid", expectedPlayerId: next.id, expectedAmount: next.basePrice });
  room = act(room, { type: "lock" }, "demo-host");
  room = act(room, { type: "sell" }, "demo-host");
  assert.equal(getTeam(room).squad.length, 3);
  assert.deepEqual(getTeam(room).lineup, saved);
  const extended = act(room, save({ ...saved!, playingXI: [...saved!.playingXI, next.id] }, 1));
  assert.equal(getTeam(extended).lineup!.playingXI.length, 3);
});

test("a former manager loses lineup rights when giving up their team seat", () => {
  const room = roomWithPurchases();
  const spectator = act(room, { type: "claim_team", teamId: null });
  rejects(spectator, save(empty()), 403, "FORBIDDEN");
  const left = act(room, { type: "leave" });
  rejects(left, save(empty()), 401, "UNAUTHORIZED");
});

test("lineup editing never invents playing-XI overseas restrictions", () => {
  const room = roomWithPurchases();
  const owned = ids(room).slice(0, 11);
  room.players.forEach(player => { if (owned.includes(player.id)) player.isOverseas = true; });
  const result = act(room, save({ ...empty(), playingXI: owned }));
  assert.equal(getTeam(result).lineup!.playingXI.length, 11);
});

test("captaincy can be saved before building an XI and survives serialized room reloads", () => {
  const room = roomWithPurchases();
  const [captainId, viceCaptainId] = ids(room);
  const before = structuredClone(room);
  const result = act(room, captaincy(captainId, viceCaptainId));
  assert.deepEqual(getTeam(result).lineup, { ...empty(), captainId, viceCaptainId, revision: 1 });
  assert.deepEqual(getTeam(JSON.parse(JSON.stringify(result))).lineup, getTeam(result).lineup);
  assert.deepEqual(result.players, before.players);
  assert.deepEqual(result.bidHistory, before.bidHistory);
  assert.deepEqual(getTeam(result).squad, getTeam(before).squad);
  assert.equal(getTeam(result).purse, getTeam(before).purse);
  assert.deepEqual(room, before);
  assert.equal(result.activity.at(-1)?.type, "captaincy");
});

test("captaincy updates preserve every XI and substitute slot, and XI edits preserve squad leaders", () => {
  const room = roomWithPurchases();
  const [first, second, reserve] = ids(room);
  const lineup = { playingXI: [null, first], substitutes: [null, null, second], captainId: first, viceCaptainId: second };
  const saved = act(room, save(lineup));
  const updated = act(saved, captaincy(reserve, second, 1));
  assert.deepEqual(getTeam(updated).lineup, { ...lineup, captainId: reserve, revision: 2 });
  const edited = act(updated, save({ ...getTeam(updated).lineup!, playingXI: [second], substitutes: [] }, 2));
  assert.deepEqual(getTeam(edited).lineup, { playingXI: [second], substitutes: [], captainId: reserve, viceCaptainId: second, revision: 3 });
  const cleared = act(edited, captaincy(null, null, 3));
  assert.deepEqual(getTeam(cleared).lineup, { ...empty(), playingXI: [second], revision: 4 });
});

test("captaincy requires the authenticated team owner, including after leaving their seat", () => {
  const room = roomWithPurchases();
  const action = captaincy(ids(room)[0], null);
  rejects(room, action, 401, "UNAUTHORIZED", "unknown-member");
  for (const member of ["demo-host", "spectator", "demo-mi"]) rejects(room, action, 403, "FORBIDDEN", member);
  rejects(room, { ...action, teamId: "mi" }, 403, "FORBIDDEN");
  for (const teamId of [null, undefined, 12, {}, ""]) rejects(room, { ...action, teamId }, 400);
  const corruptHost = structuredClone(room);
  corruptHost.members[0].role = "bidder"; corruptHost.members[0].teamId = "rcb";
  rejects(corruptHost, action, 403, "FORBIDDEN", "demo-host");
  rejects(act(room, { type: "claim_team", teamId: null }), action, 403, "FORBIDDEN");
  rejects(act(room, { type: "leave" }), action, 401, "UNAUTHORIZED");
});

test("captaincy rejects malformed, duplicate, unpurchased and other-team leaders", () => {
  const room = roomWithPurchases();
  const [first, second] = ids(room);
  const unpurchased = room.players.find(player => player.status === "available")!.id;
  for (const property of ["captainId", "viceCaptainId"]) {
    for (const value of [undefined, {}, [], false, 0, "", "x".repeat(101)]) rejects(room, { ...captaincy(null, null), [property]: value }, 400);
    for (const value of ["unknown-player", unpurchased]) rejects(room, { ...captaincy(null, null), [property]: value }, 400, "LINEUP_PLAYER_NOT_OWNED");
  }
  rejects(room, captaincy(first, first), 400);
  const sold = room.players.find(player => player.id === first)!;
  sold.soldTo = "mi";
  rejects(room, captaincy(first, second), 400, "LINEUP_PLAYER_NOT_OWNED");
  sold.soldTo = "rcb"; sold.status = "unsold";
  rejects(room, captaincy(first, second), 400, "LINEUP_PLAYER_NOT_OWNED");
  sold.status = "sold"; getTeam(room).squad = getTeam(room).squad.filter(sale => sale.playerId !== first);
  rejects(room, captaincy(first, second), 400, "LINEUP_PLAYER_NOT_OWNED");
  room.players = room.players.filter(player => player.id !== second);
  rejects(room, captaincy(null, second), 400, "LINEUP_PLAYER_NOT_OWNED");
});

test("lineup and captaincy saves share revision conflicts across tabs", () => {
  const room = roomWithPurchases();
  const [first, second] = ids(room);
  for (const expectedRevision of [undefined, null, "0", -1, 0.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER]) rejects(room, { ...captaincy(first, second), expectedRevision }, 400);
  const latest = act(room, captaincy(first, second));
  rejects(latest, captaincy(second, first), 409, "LINEUP_CONFLICT");
  rejects(latest, save(empty()), 409, "LINEUP_CONFLICT");
  const updated = act(latest, save({ ...getTeam(latest).lineup!, playingXI: [first] }, 1));
  rejects(updated, captaincy(second, first, 1), 409, "LINEUP_CONFLICT");
  assert.equal(getTeam(act(updated, captaincy(second, first, 2))).lineup!.revision, 3);
});

test("captaincy remains editable during auction breaks, unsettled rounds and after completion", () => {
  for (const phase of ["waiting", "live", "paused", "locked", "sold", "unsold"] as const) {
    const room = roomWithPurchases();
    const [first, second] = ids(room);
    room.phase = phase; room.auctionPausedAt = NOW - 100;
    const saved = act(room, captaincy(first, second));
    assert.equal(saved.phase, phase); assert.equal(saved.auctionPausedAt, room.auctionPausedAt);
    saved.endedAt = NOW; saved.completedManagers = { rcb: { id: managerId, name: "Saved manager" } };
    const ended = act(saved, captaincy(second, first, 1));
    assert.equal(ended.endedAt, NOW);
    assert.deepEqual(ended.completedManagers, saved.completedManagers);
    assert.equal(getTeam(ended).lineup!.captainId, second);
  }
});
