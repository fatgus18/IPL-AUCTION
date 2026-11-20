import assert from "node:assert/strict";
import test from "node:test";
import type { Player, TargetPicks } from "../lib/auction";

const { createDemoState }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { getActiveTargetIds }: typeof import("../lib/target-chains") = await import(new URL("../lib/target-chains.ts", import.meta.url).href);
const { LotNotificationTracker }: typeof import("../lib/lot-notifications") = await import(new URL("../lib/lot-notifications.ts", import.meta.url).href);

function fixture() {
  const state = createDemoState();
  const [first, backup] = state.players.filter(player => player.status === "available" && !player.catalogArchived && player.eligibilityVerified !== false);
  state.currentPlayerId = null; state.phase = "waiting"; state.activity = []; state.version = 1;
  const picks: TargetPicks = { teamId: "rcb", playerIds: [first.id], backups: { [first.id]: backup.id }, revision: 1 };
  state.myTargetPicks = picks;
  const tracker = new LotNotificationTracker();
  const observe = (away = false) => tracker.observe(state, { connected: true, away, targetPlayerIds: getActiveTargetIds(state.players, picks) });
  const nominate = (player: Player) => {
    state.version += 1; state.currentPlayerId = player.id; state.phase = "waiting";
    state.activity.push({ id: `lot-${state.version}`, at: state.version, type: "player", text: `${player.name} is on the auction floor.` });
  };
  observe();
  return { state, first, backup, picks, observe, nominate };
}

test("first-choice and activated-backup nominations produce private target notices", () => {
  const { state, first, backup, picks, observe, nominate } = fixture();
  nominate(first);
  assert.equal(observe()?.isTarget, true);
  first.status = "sold"; first.soldTo = "csk";
  state.phase = "sold"; state.version += 1;
  assert.equal(observe(), null, "settling the first choice is not a new lot");
  nominate(backup);
  assert.deepEqual(observe(), { key: `${state.id}:${state.code}:lot-${state.version}:${backup.id}`, playerId: backup.id, isTarget: true });
  assert.equal(observe(), null, "the activated backup announces once per nomination");
  assert.deepEqual(picks.playerIds, [first.id]);
  assert.deepEqual(picks.backups, { [first.id]: backup.id }, "notification tracking never rewrites the saved chain");
});

test("standby backups stay silent on the auction page and use generic notices away from it", () => {
  for (const away of [false, true]) {
    const { backup, observe, nominate } = fixture();
    nominate(backup);
    const notice = observe(away);
    if (away) {
      assert.equal(notice?.playerId, backup.id);
      assert.equal(notice?.isTarget, undefined);
    } else assert.equal(notice, null);
  }
});

test("securing a first choice prevents a later backup nomination from being labelled a target", () => {
  const { state, first, backup, observe, nominate } = fixture();
  nominate(first); assert.equal(observe()?.isTarget, true);
  first.status = "sold"; first.soldTo = "rcb";
  state.phase = "sold"; state.version += 1; observe();
  nominate(backup);
  assert.equal(observe(), null);
  nominate(backup);
  assert.equal(observe(true)?.isTarget, undefined, "an off-page backup notice remains generic after the chain is secured");
});

test("an unsold first choice remains active when nominated again and does not promote its backup", () => {
  const { state, first, backup, picks, observe, nominate } = fixture();
  nominate(first); observe();
  first.status = "unsold"; state.phase = "unsold"; state.version += 1;
  assert.deepEqual(getActiveTargetIds(state.players, picks), [first.id]);
  assert.equal(observe(), null, "a completed unsold lot never invites the manager to bid");
  nominate(backup); assert.equal(observe(), null);
  nominate(first); first.status = "available";
  assert.equal(observe()?.isTarget, true);
});

test("sale corrections change future target notifications without replaying an existing lot", () => {
  const { state, first, backup, observe, nominate } = fixture();
  first.status = "sold"; first.soldTo = "rcb";
  nominate(backup); assert.equal(observe(), null);
  first.soldTo = "csk"; state.version += 1;
  assert.equal(observe(), null, "correcting the first choice cannot replay the already observed backup lot");
  nominate(backup); assert.equal(observe()?.isTarget, true);
  first.status = "available"; delete first.soldTo; state.version += 1;
  assert.equal(observe(), null);
  nominate(backup); assert.equal(observe(), null, "voiding the sale puts the backup on standby again");
  nominate(first); assert.equal(observe()?.isTarget, true);
});

