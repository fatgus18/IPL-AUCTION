import assert from "node:assert/strict";
import test from "node:test";
import type { Player, RoomState } from "../lib/auction";

const { createRoomState, createDemoState }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { getSquadManager, summarizeSquad }: typeof import("../lib/squad-summary") = await import(new URL("../lib/squad-summary.ts", import.meta.url).href);
const NOW = 1_800_000_000_000;

function room() {
  const members = createDemoState().members;
  const state = createRoomState("COMPARE", "Comparison test", members[0], NOW);
  state.members = members;
  return state;
}

function purchase(state: RoomState, teamId: string, playerId: string, amount: number) {
  const team = state.teams.find(entry => entry.id === teamId)!;
  const player = state.players.find(entry => entry.id === playerId)!;
  player.status = "sold";
  player.soldTo = teamId;
  player.soldFor = amount;
  team.squad.push({ playerId, amount });
  team.purse -= amount;
  return player;
}

test("comparison uses current purchases and purse after a sale correction", () => {
  const state = room();
  const rcb = state.teams.find(team => team.id === "rcb")!;
  const csk = state.teams.find(team => team.id === "csk")!;
  purchase(state, rcb.id, "marco-jansen", 700);
  const original = summarizeSquad(state, rcb);
  assert.equal(original.spent, 700);
  assert.equal(original.remaining, 9300);
  assert.equal(original.spentPercent, 7);
  rcb.squad = [];
  rcb.purse = 10000;
  purchase(state, csk.id, "marco-jansen", 500);
  assert.equal(summarizeSquad(state, rcb).spent, 0);
  assert.equal(summarizeSquad(state, rcb).remaining, 10000);
  assert.equal(summarizeSquad(state, csk).spent, 500);
  assert.equal(summarizeSquad(state, csk).remaining, 9500);
  assert.equal(summarizeSquad(state, csk).startingBudget, 10000);
});

test("comparison counts actual roles for marquee players and does not double count", () => {
  const state = room();
  const team = state.teams.find(entry => entry.id === "rcb")!;
  purchase(state, team.id, "marco-jansen", 200);
  purchase(state, team.id, "axar-patel", 200);
  purchase(state, team.id, "sanju-samson", 200);
  const summary = summarizeSquad(state, team);
  assert.equal(summary.spots, 3);
  assert.equal(summary.overseas, 1);
  assert.deepEqual(summary.roles, [{ role: "Batter", count: 0 }, { role: "Bowler", count: 0 }, { role: "All-rounder", count: 2 }, { role: "Wicketkeeper", count: 1 }]);
});

test("empty and unclaimed squads remain honest without invented strength scores", () => {
  const state = room();
  const team = state.teams.find(entry => entry.id === "gt")!;
  state.members = state.members.filter(member => member.teamId !== team.id);
  const summary = summarizeSquad(state, team);
  assert.equal(summary.manager, null);
  assert.equal(summary.spent, 0);
  assert.equal(summary.remaining, state.settings.purse);
  assert.equal(summary.spots, 0);
  assert.equal(summary.playingXI, 0);
  assert.equal(summary.substitutes, 0);
  assert.equal(summary.captain, null);
  assert.equal(summary.viceCaptain, null);
  assert.ok(summary.roles.every(role => role.count === 0));
});

test("saved XI and leaders respect independent positions and current squad ownership", () => {
  const state = room();
  const team = state.teams.find(entry => entry.id === "rcb")!;
  const marco = purchase(state, team.id, "marco-jansen", 200);
  const axar = purchase(state, team.id, "axar-patel", 200);
  const sanju = purchase(state, team.id, "sanju-samson", 200);
  team.lineup = { playingXI: [null, null, null, null, null, null, marco.id, axar.id], substitutes: [null, null, sanju.id], captainId: marco.id, viceCaptainId: axar.id, revision: 1 };
  const summary = summarizeSquad(state, team);
  assert.equal(summary.playingXI, 2);
  assert.equal(summary.substitutes, 1);
  assert.equal(summary.captain?.name, marco.name);
  assert.equal(summary.viceCaptain?.name, axar.name);
  team.squad = team.squad.filter(purchase => purchase.playerId !== marco.id);
  team.lineup.playingXI.push(axar.id, "not-owned");
  team.lineup.substitutes.push(axar.id, sanju.id, "not-owned");
  const corrected = summarizeSquad(state, team);
  assert.equal(corrected.playingXI, 1);
  assert.equal(corrected.substitutes, 1);
  assert.equal(corrected.captain, null);
  assert.equal(corrected.viceCaptain?.id, axar.id);
});

test("completed auctions keep the recorded manager after leaving and ignore later changes", () => {
  const state = room();
  const manager = state.members.find(member => member.teamId === "rcb")!;
  assert.equal(getSquadManager(state, "rcb")?.name, manager.name);
  state.endedAt = NOW;
  state.completedManagers = { rcb: { id: manager.id, name: "Archived Manager" } };
  state.members = state.members.filter(member => member.id !== manager.id);
  assert.deepEqual(getSquadManager(state, "rcb"), { id: manager.id, name: "Archived Manager" });
  state.members.push({ ...manager, name: "Changed live name" });
  assert.equal(getSquadManager(state, "rcb")?.name, "Archived Manager");
  delete state.endedAt;
  assert.equal(getSquadManager(state, "rcb")?.name, "Changed live name");
});

test("missing player details are counted as unclassified rather than hidden", () => {
  const state = room();
  const team = state.teams[0];
  team.squad = [{ playerId: "missing", amount: 100 }];
  const summary = summarizeSquad(state, team);
  assert.equal(summary.spots, 1);
  assert.deepEqual(summary.roles.at(-1), { role: "Unclassified", count: 1 });
  assert.equal(summary.overseas, 0);
  state.players.push({ id: "missing", role: "Marquee", stats: { matches: null, runs: null, wickets: null, strikeRate: null } } as Player);
  assert.deepEqual(summarizeSquad(state, team).roles.at(-1), { role: "Unclassified", count: 1 });
});

test("zero budget produces a finite comparison bar", () => {
  const state = room();
  state.settings.purse = 0;
  assert.equal(summarizeSquad(state, state.teams[0]).spentPercent, 0);
});
