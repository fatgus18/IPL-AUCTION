import assert from "node:assert/strict";
import test from "node:test";
import type { TargetPicks } from "../lib/auction";

const { createDemoState }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { getActiveTargetIds, getTargetChains, getTargetPlayerIds }: typeof import("../lib/target-chains") = await import(new URL("../lib/target-chains.ts", import.meta.url).href);

function fixture() {
  const state = createDemoState();
  const [first, backup, single] = state.players.filter(player => player.eligibilityVerified !== false && player.status === "available");
  const picks: TargetPicks = { teamId: "rcb", playerIds: [first.id, single.id], backups: { [first.id]: backup.id }, revision: 1 };
  return { state, first, backup, single, picks };
}

test("an available or unsold first choice stays active and its backup remains on standby", () => {
  const { state, first, backup, single, picks } = fixture();
  const before = structuredClone(picks);
  assert.deepEqual(getActiveTargetIds(state.players, picks), [first.id, single.id]);
  assert.deepEqual(getTargetPlayerIds(picks), [first.id, backup.id, single.id]);
  first.status = "unsold";
  assert.equal(getTargetChains(state.players, picks)[0].status, "first-choice");
  backup.status = "sold"; backup.soldTo = "rcb";
  assert.deepEqual(getActiveTargetIds(state.players, picks), [first.id, single.id]);
  assert.deepEqual(picks, before);
});

test("losing or archiving a first choice activates an eligible backup and own purchase secures the chain", () => {
  const { state, first, backup, single, picks } = fixture();
  first.status = "sold"; first.soldTo = "csk";
  assert.deepEqual(getTargetChains(state.players, picks)[0], { firstChoiceId: first.id, backupId: backup.id, activePlayerId: backup.id, status: "backup-active" });
  backup.status = "unsold";
  assert.deepEqual(getActiveTargetIds(state.players, picks), [backup.id, single.id]);
  first.soldTo = "rcb";
  assert.equal(getTargetChains(state.players, picks)[0].status, "secured");
  assert.deepEqual(getActiveTargetIds(state.players, picks), [single.id]);
  first.status = "available"; delete first.soldTo; first.catalogArchived = true;
  assert.equal(getTargetChains(state.players, picks)[0].status, "backup-active");
  delete first.catalogArchived; first.eligibilityVerified = false;
  assert.equal(getTargetChains(state.players, picks)[0].status, "backup-active");
});

test("unavailable backups never become active and historical chains survive reversible sale corrections", () => {
  const { state, first, backup, single, picks } = fixture();
  const before = structuredClone(picks);
  first.status = "sold"; first.soldTo = "csk";
  backup.status = "sold"; backup.soldTo = "mi";
  assert.equal(getTargetChains(state.players, picks)[0].status, "unavailable");
  backup.soldTo = "rcb";
  assert.equal(getTargetChains(state.players, picks)[0].status, "secured");
  backup.status = "available"; delete backup.soldTo;
  for (const patch of [{ catalogArchived: true }, { catalogArchived: false, eligibilityVerified: false }]) {
    Object.assign(backup, patch);
    assert.deepEqual(getActiveTargetIds(state.players, picks), [single.id]);
  }
  backup.eligibilityVerified = true;
  assert.deepEqual(getActiveTargetIds(state.players, picks), [backup.id, single.id]);
  first.status = "available"; delete first.soldTo;
  assert.deepEqual(getActiveTargetIds(state.players, picks), [first.id, single.id], "voiding a sale restores first-choice priority");
  first.status = "sold"; first.soldTo = "rcb";
  assert.equal(getTargetChains(state.players, picks)[0].status, "secured");
  first.soldTo = "mi";
  assert.equal(getTargetChains(state.players, picks)[0].status, "backup-active", "correcting own purchase to another team restores the backup");
  assert.deepEqual(picks, before, "sale handling derives state without destroying saved alternatives");
});

test("missing players and inherited backup keys are safely ignored", () => {
  const { state, first, backup, picks } = fixture();
  state.players = state.players.filter(player => player.id !== first.id);
  assert.equal(getTargetChains(state.players, picks)[0].activePlayerId, backup.id);
  state.players = state.players.filter(player => player.id !== backup.id);
  assert.equal(getTargetChains(state.players, picks)[0].status, "unavailable");
  const inherited = { teamId: "rcb", playerIds: ["constructor"], backups: Object.create({ constructor: backup.id }) };
  assert.deepEqual(getTargetPlayerIds(inherited), ["constructor"]);
  assert.equal(getTargetChains(state.players, inherited)[0].backupId, undefined);
});
