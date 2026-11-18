import assert from "node:assert/strict";
import sharp from "sharp";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Use the isolated API runner for poster tests.");
const base = process.env.BASE_URL;
let host;
const request = async (path, token, body) => {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: base }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
  return response;
};
const json = async response => { const data = await response.json(); assert.ok(response.ok, `${response.status}: ${data.error}`); return data; };
const act = (member, action) => request(`/api/rooms/${host.state.code}/action`, member.token, { action }).then(json);
try {
  host = await request("/api/rooms", undefined, { name: "Poster quality checks", hostName: "Poster creator" }).then(json);
  const room = `/api/rooms/${host.state.code}`;
  const password = (await request(`${room}/access`, host.token, {}).then(json)).teamPassword;
  const manager = await request(`${room}/join`, undefined, { name: "Poster manager", teamId: "rcb", teamPassword: password }).then(json);
  const viewer = await request(`${room}/join`, undefined, { name: "Poster spectator" }).then(json);
  for (const token of [undefined, "invalid-token"]) assert.equal((await request(`${room}/poster?team=rcb`, token)).status, 401);
  const early = await request(`${room}/poster?team=rcb`, manager.token); assert.equal(early.status, 409); assert.equal((await early.json()).code, "AUCTION_NOT_ENDED");
  const player = host.state.players.find(player => !player.isOverseas && player.eligibilityVerified !== false);
  await act(host, { type: "select_player", playerId: player.id }); await act(host, { type: "start" });
  await act(manager, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice });
  await act(host, { type: "lock" }); const sold = (await act(host, { type: "sell" })).state;
  await act(manager, { type: "set_lineup", teamId: "rcb", expectedRevision: 0, lineup: { playingXI: [null, null, null, null, null, null, player.id], substitutes: [], captainId: player.id, viceCaptainId: null } });
  await act(host, { type: "end_auction", expectedResultsRevision: sold.resultsRevision });
  const before = (await request(room, host.token).then(json)).state;
  for (const member of [host, manager, viewer]) {
    const response = await request(`${room}/poster?team=rcb`, member.token); assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png"); assert.match(response.headers.get("cache-control"), /private, no-store/); assert.ok(response.headers.get("vary").split(",").some(value => value.trim().toLowerCase() === "authorization"));
    assert.match(response.headers.get("content-disposition"), /^attachment; filename="pavilion-[A-Z0-9]+-RCB-squad-r\d+\.png"$/);
    const bytes = Buffer.from(await response.arrayBuffer()); const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, 1440); assert.equal(metadata.height, 1800); assert.ok(bytes.length > 20000);
    assert.ok(!bytes.includes(Buffer.from(password)), "password must not enter poster metadata");
  }
  const after = (await request(room, host.token).then(json)).state;
  assert.deepEqual(after.teams, before.teams); assert.equal(after.resultsRevision, before.resultsRevision, "poster generation is read-only");
  assert.equal((await request(`${room}/poster?team=mi`, manager.token)).status, 409);
  assert.equal((await request(`${room}/poster?team=..%2F..%2F.env.local`, viewer.token)).status, 404);
  const other = await request("/api/rooms", undefined, { name: "Unrelated poster room", hostName: "Other creator" }).then(json);
  try { assert.equal((await request(`${room}/poster?team=rcb`, other.token)).status, 401); }
  finally { await request(`/api/rooms/${other.state.code}/delete`, other.token, { confirmationCode: other.state.code }); }
  console.log("Franchise posters API: completion gate, authenticated host/manager/spectator downloads, PNG dimensions, headers, privacy, empty squad and cross-room isolation passed.");
} finally { if (host) await request(`/api/rooms/${host.state.code}/delete`, host.token, { confirmationCode: host.state.code }); }
