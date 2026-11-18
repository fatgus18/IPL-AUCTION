import assert from "node:assert/strict";
import { test } from "node:test";
import { canBuildXI, canViewMySquad, canViewTargets, normalizeRoomView, parseRoomView, type RoomView } from "../lib/room-navigation.ts";

const host = { role: "auctioneer", teamId: null } as const;
const owner = { role: "bidder", teamId: "rcb" } as const;
const spectator = { role: "spectator", teamId: null } as const;
const sharedViews: RoomView[] = ["room", "players", "squads", "settings"];

test("legacy and malformed room views cannot open an unknown page", () => {
  for (const raw of [null, "", "practice", "home", "lineup", "build-XI", "my-squad/settings", "<script>"]) {
    assert.equal(parseRoomView(raw), "room");
  }
  for (const view of [...sharedViews, "my-squad", "build-xi", "targets"] as RoomView[]) assert.equal(parseRoomView(view), view);
});

test("auctioneers never receive personal navigation, even if a legacy snapshot has a team id", () => {
  for (const member of [host, { ...host, teamId: "rcb" }]) {
    assert.equal(canViewMySquad(member), false);
    assert.equal(canBuildXI(member), false);
    assert.equal(canViewTargets(member), false);
    assert.equal(normalizeRoomView("my-squad", member), "room");
    assert.equal(normalizeRoomView("build-xi", member), "room");
    assert.equal(normalizeRoomView("targets", member), "room");
  }
});

test("private target lists are available only to a bidder managing a team", () => {
  assert.equal(canViewTargets(owner), true);
  assert.equal(normalizeRoomView("targets", owner), "targets");
  for (const member of [undefined, host, spectator, { ...spectator, teamId: "rcb" }, { ...owner, teamId: null }, { ...owner, teamId: "" }]) {
    assert.equal(canViewTargets(member), false);
    assert.equal(normalizeRoomView("targets", member), "room");
  }
});

test("only a bidder with an assigned team may open the independent lineup editor", () => {
  assert.equal(canViewMySquad(owner), true);
  assert.equal(canBuildXI(owner), true);
  assert.equal(normalizeRoomView("my-squad", owner), "my-squad");
  assert.equal(normalizeRoomView("build-xi", owner), "build-xi");
  for (const member of [undefined, spectator, { ...spectator, teamId: "rcb" }, { ...owner, teamId: null }, { ...owner, teamId: "" }]) {
    assert.equal(canBuildXI(member), false);
    assert.equal(normalizeRoomView("build-xi", member), "room");
  }
});

test("spectators retain the honest empty My Squad view but missing membership does not", () => {
  assert.equal(canViewMySquad(spectator), true);
  assert.equal(normalizeRoomView("my-squad", spectator), "my-squad");
  assert.equal(canViewMySquad(undefined), false);
  assert.equal(normalizeRoomView("my-squad", undefined), "room");
});

test("personal-page guards preserve shared auction navigation for all real roles", () => {
  for (const member of [host, owner, spectator]) {
    for (const view of sharedViews) assert.equal(normalizeRoomView(view, member), view);
  }
});
