import assert from "node:assert/strict";
import ExcelJS from "exceljs";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Export checks only create and change isolated test rooms.");
assert.match(process.env.DATABASE_URL || "", /^file:/);
const base = process.env.BASE_URL;
const request = async (path, { token, body } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, data: await response.json() };
};
const ok = response => { assert.ok(response.status >= 200 && response.status < 300, `${response.status}: ${response.data.error}`); return response.data; };
const pathFor = room => `/api/rooms/${room.state.code}`;
const act = (room, action) => request(`${pathFor(room)}/action`, { token: room.token, body: { action } }).then(ok).then(data => data.state);
const read = room => request(pathFor(room), { token: room.token }).then(ok).then(data => data.state);
const download = (room, format, token = room.token) => fetch(`${base}${pathFor(room)}/export?format=${format}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(20000) });
const workbookFrom = async response => {
  assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /spreadsheetml.sheet/);
  assert.match(response.headers.get("cache-control"), /no-store/); assert.match(response.headers.get("vary"), /Authorization/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-disposition"), /^attachment; filename="pavilion-[A-Z0-9]+-recap-r\d+\.xlsx"$/);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await response.arrayBuffer())); return workbook;
};
const allValues = workbook => {
  const values = []; workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => values.push(cell.value)))); return JSON.stringify(values);
};
let host;
try {
  host = ok(await request("/api/rooms", { body: { name: "Download verification", hostName: "Export creator" } }));
  const password = ok(await request(`${pathFor(host)}/access`, { token: host.token, body: {} })).teamPassword;
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword: password } : {}) } }).then(ok);
  const owner = await join("Export manager", "rcb");
  const rival = await join("Other manager", "mi");
  const spectator = await join("Recap reader");
  const differentRoom = ok(await request("/api/rooms", { body: { name: "Unrelated room", hostName: "Unrelated creator" } }));
  for (const token of ["", "not-a-room-credential", differentRoom.token]) {
    const denied = await download(host, "xlsx", token); assert.equal(denied.status, 401); assert.match(denied.headers.get("cache-control"), /no-store/);
  }
  assert.equal((await download(host, "csv")).status, 400);
  for (const caller of [host, owner, spectator]) for (const format of ["xlsx", "pdf"]) {
    const early = await download(caller, format); assert.equal(early.status, 409); assert.equal((await early.json()).code, "AUCTION_NOT_ENDED");
  }
  const players = host.state.players.filter(player => player.eligibilityVerified !== false && !player.catalogArchived && !player.isOverseas).slice(0, 4);
  assert.equal(players.length, 4);
  await act(owner, { type: "set_target_picks", teamId: "rcb", playerIds: [players[3].id], expectedRevision: 0 });
  const secretChat = "CHAT-DO-NOT-EXPORT-91832";
  await act(owner, { type: "chat", text: secretChat });
  for (let index = 0; index < 3; index++) {
    const player = players[index], buyer = index === 2 ? rival : owner;
    await act(host, { type: "select_player", playerId: player.id }); await act(host, { type: "start" });
    await act(buyer, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice, customAmount: 400 + index * 50 });
    await act(host, { type: "lock" }); await act(host, { type: "sell" });
  }
  const lineup = { playingXI: [players[1].id, null, null, null, null, null, players[0].id, null, null, null, null], substitutes: Array(5).fill(null), captainId: players[0].id, viceCaptainId: players[1].id };
  await act(owner, { type: "set_lineup", teamId: "rcb", lineup, expectedRevision: 0 });
  let state = await read(host);
  state = await act(host, { type: "end_auction", expectedResultsRevision: state.resultsRevision ?? 0 });
  for (const caller of [host, owner, spectator]) {
    const workbook = await workbookFrom(await download(caller, "xlsx"));
    const values = allValues(workbook);
    for (const secret of [secretChat, host.token, owner.token, password, "myTargetPicks", "privateTargetPicks", "tokenHashes"]) assert.ok(!values.includes(secret), "download must omit secrets/private research/chat");
    assert.ok(!values.includes(players[3].name), "an unpurchased target must not appear in recap");
    const all = workbook.getWorksheet("All players"); assert.equal(all.rowCount, 7);
    const names = [5, 6, 7].map(row => all.getCell(row, 3).value);
    assert.deepEqual(new Set(names), new Set(players.slice(0, 3).map(player => player.name)));
    assert.equal([5, 6, 7].reduce((sum, row) => sum + all.getCell(row, 11).value, 0), 1350);
    for (const row of [5, 6, 7]) for (let column = 12; column <= 17; column++) assert.equal(all.getCell(row, column).value, null);
    const rcb = workbook.getWorksheet("RCB");
    assert.equal(rcb.getCell("C5").value, players[1].name); assert.equal(rcb.getCell("H5").value, 1); assert.equal(rcb.getCell("J5").value, "Yes");
    assert.equal(rcb.getCell("C6").value, players[0].name); assert.equal(rcb.getCell("H6").value, 7); assert.equal(rcb.getCell("I6").value, "Yes");
    const pdf = await download(caller, "pdf"); assert.equal(pdf.status, 200); assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.match(pdf.headers.get("cache-control"), /no-store/); assert.match(pdf.headers.get("content-disposition"), /\.pdf"$/);
    const bytes = Buffer.from(await pdf.arrayBuffer()); assert.equal(bytes.subarray(0, 5).toString(), "%PDF-"); assert.ok(bytes.length < 1_000_000);
  }
  await act(owner, { type: "set_lineup", teamId: "rcb", lineup: { ...lineup, captainId: players[1].id, viceCaptainId: players[0].id }, expectedRevision: 1 });
  await act(host, { type: "correct_sale", playerId: players[0].id, expectedTeamId: "rcb", expectedAmount: 400, expectedResultsRevision: state.resultsRevision, teamId: "rcb", amount: 600, reason: "Correct the recorded final amount" });
  const revised = await workbookFrom(await download(host, "xlsx"));
  const revisedRcb = revised.getWorksheet("RCB"); assert.equal(revisedRcb.getCell("I5").value, "Yes"); assert.equal(revisedRcb.getCell("J6").value, "Yes");
  assert.equal(revisedRcb.getCell("K6").value, 600);
  const audit = revised.getWorksheet("Audit"); assert.equal(audit.getCell("E5").value, 400); assert.equal(audit.getCell("G5").value, 600);
  assert.equal(audit.getCell("H5").value, "Correct the recorded final amount");
  await act(owner, { type: "leave" });
  const afterDeparture = await workbookFrom(await download(spectator, "xlsx"));
  assert.equal(afterDeparture.getWorksheet("RCB").getCell("B5").value, "Export manager", "manager remains in recap after leaving");
  assert.equal((await download(owner, "xlsx")).status, 401, "a revoked room session cannot download results");
  await request(`${pathFor(differentRoom)}/delete`, { token: differentRoom.token, body: { confirmationCode: differentRoom.state.code } }).then(ok);
  console.log("Auction exports API: completion gate, authenticated PDF/Excel, full squads, blank match stats, C/VC, latest corrections and privacy passed.");
} finally {
  if (host) await request(`${pathFor(host)}/delete`, { token: host.token, body: { confirmationCode: host.state.code } }).then(ok);
}
