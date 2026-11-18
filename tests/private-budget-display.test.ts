import assert from "node:assert/strict";
import test from "node:test";
import type { Player } from "../lib/auction";

const { createDemoState }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { budgetInputsFromSaved, budgetInputValue, budgetLimitValue, parseBudgetInputs, privateBudgetPlan, sameBudgetInputs, sameBudgetValues, currentPrivateBudget }: typeof import("../lib/private-budget-display") = await import(new URL("../lib/private-budget-display.ts", import.meta.url).href);

function fixture() {
  const state = createDemoState();
  const owner = state.members.find((member) => member.role === "bidder" && member.teamId === "rcb")!;
  const player = state.players.find((entry) => entry.status === "available")!;
  state.currentPlayerId = player.id;
  state.phase = "live";
  state.currentBid = 200;
  state.leadingTeamId = "mi";
  state.myTargetPicks = { teamId: "rcb", playerIds: [player.id], revision: 1, maxBids: { [player.id]: 500 } };
  return { state, owner, player };
}

test("private limit input preserves exact whole-lakh values and rejects ambiguous or out-of-range amounts", () => {
  const parsed = parseBudgetInputs(["minimum", "normal", "maximum", "blank", "negative", "rounding", "infinity", "excess", "zero", "exponent"], {
    minimum: ".01", normal: " 5.25 ", maximum: "1000.00", blank: " ", negative: "-1", rounding: "0.001", infinity: "Infinity", excess: "1000.01", zero: "0", exponent: "1e2", ignored: "12",
  });
  assert.deepEqual(parsed.maxBids, { minimum: 1, normal: 525, maximum: 100000 });
  assert.deepEqual(parsed.invalidIds, ["negative", "rounding", "infinity", "excess", "zero", "exponent"]);
  assert.deepEqual(budgetInputsFromSaved(parsed.maxBids), { minimum: "0.01", normal: "5.25", maximum: "1000.00" });
});

test("budget-only edits and invalid draft text remain distinguishable from the saved list", () => {
  assert.equal(sameBudgetInputs({ p: "5.00" }, { p: "7.00" }), false);
  assert.equal(sameBudgetInputs({ p: "5.00" }, { p: "bad text" }), false);
  assert.equal(sameBudgetInputs({ p: "5.00", empty: " " }, { p: "5.00" }), true);
  assert.equal(sameBudgetInputs({ p: "5.00" }, {}), false);
  assert.equal(sameBudgetValues({ p: 500, q: 250 }, { q: 250, p: 500 }), true);
  assert.equal(sameBudgetValues({ p: 500 }, { p: 525 }), false);
  assert.equal(sameBudgetValues({ p: 500 }, { p: 500, q: 1 }), false);
  const text = { p: "5.", q: "not a number" };
  parseBudgetInputs(["p", "q"], text);
  assert.deepEqual(text, { p: "5.", q: "not a number" }, "parsing cannot rewrite what the manager has typed");
});

test("planning totals exclude every purchase, missing players and archived targets but include unsold targets", () => {
  const { player } = fixture();
  const players: Player[] = [
    { ...player, id: "open", status: "available" }, { ...player, id: "unpriced", status: "available" },
    { ...player, id: "again", status: "unsold" }, { ...player, id: "mine", status: "sold", soldTo: "rcb" },
    { ...player, id: "rival", status: "sold", soldTo: "mi" }, { ...player, id: "removed", catalogArchived: true },
  ];
  const ids = ["open", "unpriced", "again", "mine", "rival", "removed", "missing", "open"];
  const limits = { open: 600, again: 500, mine: 100, rival: 100, removed: 100, missing: 100 };
  assert.deepEqual(privateBudgetPlan(players, ids, limits, 1000), { planned: 1100, unpriced: 1, remaining: 3, overallocated: 100, unallocated: 0 });
  assert.deepEqual(privateBudgetPlan(players, ids, limits, 1500), { planned: 1100, unpriced: 1, remaining: 3, overallocated: 0, unallocated: 400 });
});

test("private reminders distinguish approaching, reached and exceeded limits without changing bidding state", () => {
  const { state, owner, player } = fixture();
  const baseline = structuredClone(state);
  assert.equal(currentPrivateBudget(state, owner.id)?.warning, "within");
  assert.deepEqual(state, baseline);
  state.currentBid = 490;
  assert.equal(currentPrivateBudget(state, owner.id)?.nextBid, 500, "legacy off-grid bids round to the next quarter-crore amount");
  assert.equal(currentPrivateBudget(state, owner.id)?.warning, "within");
  state.myTargetPicks!.maxBids![player.id] = 490;
  state.currentBid = 475;
  assert.equal(currentPrivateBudget(state, owner.id)?.warning, "next-over");
  state.leadingTeamId = "rcb";
  assert.equal(currentPrivateBudget(state, owner.id)?.warning, "within", "a leading team is not asked to outbid itself");
  state.myTargetPicks!.maxBids![player.id] = 500;
  state.currentBid = 500;
  assert.equal(currentPrivateBudget(state, owner.id)?.warning, "at");
  state.currentBid = 525;
  assert.equal(currentPrivateBudget(state, owner.id)?.warning, "over");
  state.currentBid = 0; state.leadingTeamId = null; state.phase = "waiting";
  state.myTargetPicks!.maxBids![player.id] = player.basePrice - 1;
  assert.equal(currentPrivateBudget(state, owner.id)?.warning, "next-over", "below-base plans warn before the opening bid");
});

test("private reminders never appear for hosts, spectators, mismatched teams, inactive lots or ended auctions", () => {
  const { state, owner, player } = fixture();
  assert.equal(currentPrivateBudget(state, state.hostId), null);
  assert.equal(currentPrivateBudget(state, "missing-member"), null);
  owner.role = "spectator";
  assert.equal(currentPrivateBudget(state, owner.id), null);
  owner.role = "bidder"; owner.teamId = "mi";
  assert.equal(currentPrivateBudget(state, owner.id), null);
  owner.teamId = "rcb";
  for (const phase of ["sold", "unsold"] as const) {
    state.phase = phase;
    assert.equal(currentPrivateBudget(state, owner.id), null);
  }
  state.phase = "live"; state.endedAt = Date.now();
  assert.equal(currentPrivateBudget(state, owner.id), null);
  delete state.endedAt; player.catalogArchived = true;
  assert.equal(currentPrivateBudget(state, owner.id), null);
  delete player.catalogArchived; state.myTargetPicks!.playerIds = [];
  assert.equal(currentPrivateBudget(state, owner.id), null, "a removed target must not keep a reminder");
});

test("missing or malformed saved limits do not produce a false limit warning", () => {
  const { state, owner, player } = fixture();
  for (const amount of [0, -1, 1.5, NaN, Infinity, 100001]) {
    state.myTargetPicks!.maxBids = { [player.id]: amount };
    assert.equal(currentPrivateBudget(state, owner.id), null);
  }
  delete state.myTargetPicks!.maxBids;
  assert.equal(currentPrivateBudget(state, owner.id), null);
});

test("prototype-named targets and inherited limits cannot crash inputs or poison planning totals", () => {
  const ids = ["constructor", "__proto__", "toString", "hasOwnProperty"];
  for (const id of ids) {
    assert.equal(budgetInputValue({}, id), "");
    assert.equal(budgetLimitValue({}, id), undefined);
  }
  assert.deepEqual(parseBudgetInputs(ids, {}), { maxBids: {}, invalidIds: [] });
  const inheritedInputs = Object.create({ constructor: "99.00", __proto__: "99.00", toString: "99.00" });
  assert.deepEqual(parseBudgetInputs(ids, inheritedInputs), { maxBids: {}, invalidIds: [] });
  const ownInputs = Object.fromEntries(ids.map((id) => [id, "1.00"]));
  const amounts = parseBudgetInputs(ids, ownInputs).maxBids;
  assert.equal(Object.getPrototypeOf(amounts), Object.prototype);
  for (const id of ids) assert.equal(budgetLimitValue(amounts, id), 100, "explicit entries are ordinary data properties");
  assert.equal(sameBudgetInputs(ownInputs, inheritedInputs), false);
  assert.equal(sameBudgetValues(amounts, Object.create(amounts)), false);
  const { player, state, owner } = fixture();
  const players = ids.map((id) => ({ ...player, id }));
  assert.deepEqual(privateBudgetPlan(players, ids, Object.create(amounts), 1000), { planned: 0, unpriced: 4, remaining: 4, overallocated: 0, unallocated: 1000 });
  player.id = "constructor"; state.currentPlayerId = player.id;
  state.myTargetPicks = { teamId: "rcb", revision: 1, playerIds: [player.id], maxBids: Object.create({ constructor: 100 }) };
  assert.equal(currentPrivateBudget(state, owner.id), null);
});
