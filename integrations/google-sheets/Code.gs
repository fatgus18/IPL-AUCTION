/**
 * Pavilion's manually refreshed ESPNcricinfo MVP feed.
 * Bind this script to the destination spreadsheet. No triggers or web app are installed.
 * @OnlyCurrentDoc
 */
const PAVILION_CONFIG_SHEET = 'Pavilion Config';
const PAVILION_FEED_SHEET = 'Pavilion MVP Feed';
const PAVILION_DEFAULT_SOURCE = 'https://www.cricinfo.com/series/ipl-2026-1510719/most-valuable-players';
const PAVILION_MARKER = 'PAVILION_MVP_FEED_V1';
const PAVILION_MAX_BYTES = 4000000;
const PAVILION_MAX_PLAYERS = 1000;
const PAVILION_FETCH_WINDOW_MS = 45000;
const PAVILION_HEADERS = [
  'Player ID', 'Player', 'Total Impact', 'Matches', 'Runs', 'Wkts', 'Team',
  'Batting Impact', 'Bowling Impact', 'Source URL', 'Source Captured At', 'Expected Row Count'
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Pavilion')
    .addItem('Set up season feed', 'pavilionSetup')
    .addItem('Fetch latest MVP data', 'pavilionRefresh')
    .addToUi();
}

function pavilionSetup() {
  const lock = pavilionLock_();
  try {
    const sheets = pavilionSheets_(true);
    const config = sheets.config;
    if (!config.getRange(1, 1).getValue()) {
      config.getRange(1, 1, 10, 2).setValues([
        ['Pavilion auction season', 'Manual refresh'],
        ['Source URL', PAVILION_DEFAULT_SOURCE],
        ['Status', 'Not refreshed'],
        ['Last attempt (UTC)', ''],
        ['Last successful source capture (UTC)', ''],
        ['Players in feed', 0],
        ['Series', ''],
        ['Feed CSV URL', ''],
        ['Refresh mode', 'Pavilion menu > Fetch latest MVP data'],
        ['Data integrity', 'A failed fetch or invalid table keeps the last successful feed.']
      ]);
    }
    config.getRange(8, 2).setValue('https://docs.google.com/spreadsheets/d/' + sheets.book.getId() + '/export?format=csv&gid=' + sheets.feed.getSheetId());
    config.setColumnWidth(1, 280).setColumnWidth(2, 650);
    config.getRange(1, 1, 1, 2).setBackground('#101c2b').setFontColor('#ffffff').setFontWeight('bold');
    config.getRange(2, 2).setBackground('#fff2cc').setNumberFormat('@');
    config.getRange(4, 2, 2, 1).setNumberFormat('@');
    config.getRange(3, 2, 8, 1).setWrap(true);
    sheets.feed.getRange(1, 1, 1, PAVILION_HEADERS.length).setValues([PAVILION_HEADERS]);
    pavilionFormatFeed_(sheets.feed);
    SpreadsheetApp.flush();
    sheets.book.toast('Edit Source URL in Pavilion Config, then use Pavilion > Fetch latest MVP data.', 'Pavilion', 8);
  } finally { lock.releaseLock(); }
}

function pavilionRefresh() {
  const lock = pavilionLock_();
  let sheets = null;
  let feedWritten = false;
  try {
    sheets = pavilionSheets_(false);
    const source = pavilionValidateSource_(String(sheets.config.getRange(2, 2).getValue()).trim());
    sheets.config.getRange(3, 2).setValue('Fetching source…');
    sheets.config.getRange(4, 2).setValue(new Date().toISOString());
    const captured = pavilionFetchHtml_(source);
    const snapshot = pavilionParseMvpHtml_(captured.html, source.canonicalUrl, captured.capturedAt);
    const currentSource = pavilionValidateSource_(String(sheets.config.getRange(2, 2).getValue()).trim());
    if (currentSource.canonicalUrl !== source.canonicalUrl) throw new Error('Source URL changed during refresh. Fetch the newly selected source again.');
    pavilionWriteFeed_(sheets.feed, snapshot);
    feedWritten = true;
    sheets.config.getRange(3, 2).setValue('Updated ' + snapshot.rows.length + ' players.');
    sheets.config.getRange(5, 2).setValue(snapshot.capturedAt);
    sheets.config.getRange(6, 2).setValue(snapshot.rows.length);
    sheets.config.getRange(7, 2).setValue(pavilionSafeCell_(snapshot.seriesName));
    SpreadsheetApp.flush();
    sheets.book.toast('Updated ' + snapshot.rows.length + ' player scores from ESPNcricinfo.', 'Pavilion', 6);
    return snapshot.rows.length;
  } catch (error) {
    const message = (error && error.message ? String(error.message) : 'The refresh failed.').slice(0, 350);
    const status = feedWritten
      ? 'Feed written; status update failed. ' + message
      : 'Not updated; last successful feed kept. ' + message;
    if (sheets) {
      try { sheets.config.getRange(3, 2).setValue(pavilionSafeCell_(status)); } catch (_) { /* Keep the original error. */ }
      try { sheets.book.toast(status, 'Pavilion', 10); } catch (_) { /* No UI is required for data integrity. */ }
    }
    throw new Error(status);
  } finally { lock.releaseLock(); }
}

function pavilionLock_() {
  const lock = LockService.getDocumentLock();
  if (!lock) throw new Error('Install this as a bound script using the spreadsheet’s Extensions > Apps Script menu.');
  if (!lock.tryLock(5000)) throw new Error('Another Pavilion update is running. Try again when it finishes.');
  return lock;
}

function pavilionSheets_(create) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('Open the bound spreadsheet first.');
  const names = [PAVILION_CONFIG_SHEET, PAVILION_FEED_SHEET];
  const found = names.map(function(name) { return book.getSheetByName(name); });
  // Inspect both names before creating anything. Never replace an existing user tab.
  found.forEach(function(sheet, index) {
    if (sheet && !sheet.getDeveloperMetadata().some(function(item) { return item.getKey() === PAVILION_MARKER && item.getValue() === names[index]; })) {
      throw new Error('A tab named "' + names[index] + '" already exists and is not managed by Pavilion. Rename that tab before setup.');
    }
    if (!sheet && !create) throw new Error('Run Pavilion > Set up season feed first.');
  });
  const managed = found.map(function(sheet, index) {
    if (sheet) return sheet;
    return book.insertSheet(names[index]).addDeveloperMetadata(PAVILION_MARKER, names[index]);
  });
  return { book: book, config: managed[0], feed: managed[1] };
}

function pavilionValidateSource_(input) {
  if (typeof input !== 'string' || input.length > 2048 || /[\\\u0000-\u0020]/.test(input)) throw new Error('Use a complete HTTPS ESPNcricinfo series MVP link.');
  // Apps Script does not provide the browser URL API. Match the entire input,
  // exact public host and exact MVP route; credentials, ports and encoded paths fail.
  const match = input.match(/^https:\/\/((?:www\.)?(?:espncricinfo|cricinfo)\.com)(\/series\/((?:[a-zA-Z][a-zA-Z0-9-]*-)?([1-9]\d{0,9}))\/most-valuable-players)\/?(?:[?#][^\s\\]*)?$/i);
  if (!match) throw new Error('Only official HTTPS Cricinfo / ESPNcricinfo most-valuable-players series links are supported.');
  const path = match[2];
  return { url: 'https://' + match[1].toLowerCase() + path, canonicalUrl: 'https://www.cricinfo.com' + path, seriesId: match[4] };
}

function pavilionRedirect_(location, previous, seriesId) {
  if (typeof location !== 'string' || /[\\\u0000-\u0020]/.test(location)) throw new Error('The provider returned an unsafe redirect.');
  let target = location;
  if (target.indexOf('//') === 0) target = 'https:' + target;
  else if (target.indexOf('/') === 0) target = previous.match(/^https:\/\/[^/]+/)[0] + target;
  const checked = pavilionValidateSource_(target);
  if (checked.seriesId !== seriesId) throw new Error('The provider redirected to a different series.');
  return checked.url;
}

function pavilionHeader_(headers, name) {
  const key = Object.keys(headers).find(function(key) { return key.toLowerCase() === name; });
  return key === undefined ? '' : String(headers[key]);
}

function pavilionFetchHtml_(source) {
  let url = source.canonicalUrl;
  const started = Date.now();
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (Date.now() - started > PAVILION_FETCH_WINDOW_MS) throw new Error('The provider took too long. Try again later.');
    const response = UrlFetchApp.fetch(url, {
      method: 'get', followRedirects: false, muteHttpExceptions: true,
      validateHttpsCertificates: true, headers: { Accept: 'text/html' }
    });
    // UrlFetchApp has no supported per-request timeout or streaming API. Bound
    // requests, redirects and accepted response size; never pretend to cancel it.
    if (Date.now() - started > PAVILION_FETCH_WINDOW_MS) throw new Error('The provider took too long. Try again later.');
    const status = response.getResponseCode();
    const headers = response.getAllHeaders();
    if ([301, 302, 303, 307, 308].indexOf(status) !== -1) {
      if (redirects === 3) throw new Error('The provider redirected too many times.');
      url = pavilionRedirect_(pavilionHeader_(headers, 'location'), url, source.seriesId);
      continue;
    }
    if (status !== 200) throw new Error('ESPNcricinfo returned HTTP ' + status + '. No scores changed; try later. Access restrictions are not bypassed.');
    const contentType = pavilionHeader_(headers, 'content-type');
    if (contentType && !/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) throw new Error('The provider did not return an HTML MVP page.');
    if (Number(pavilionHeader_(headers, 'content-length') || 0) > PAVILION_MAX_BYTES) throw new Error('The provider response exceeds the 4 MB limit.');
    if (response.getContent().length > PAVILION_MAX_BYTES) throw new Error('The provider response exceeds the 4 MB limit.');
    return { html: response.getContentText('UTF-8'), capturedAt: new Date().toISOString() };
  }
  throw new Error('The provider could not resolve this page.');
}

function pavilionObject_(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function pavilionName_(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= 120 && !/[<>\u0000-\u001f\u007f]/.test(name) ? name : null;
}

function pavilionId_(value) {
  return (typeof value === 'number' || typeof value === 'string') && /^[1-9]\d{0,9}$/.test(String(value)) ? String(value) : null;
}

function pavilionNumber_(value, signed, integer, required) {
  if (value === undefined || value === null || value === '' || value === '-' || value === '—') {
    if (required) throw new Error('A player row is missing Total Impact.');
    return '';
  }
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^-?\d+(?:\.\d{1,6})?$/.test(String(value))) throw new Error('The source contains an invalid numeric statistic.');
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 1000000 || (!signed && number < 0) || (integer && !Number.isInteger(number))) throw new Error('The source contains an invalid numeric statistic.');
  return number;
}

function pavilionParseMvpHtml_(html, sourceUrl, capturedAt) {
  const source = pavilionValidateSource_(sourceUrl);
  if (typeof html !== 'string' || Utilities.newBlob(html).getBytes().length > PAVILION_MAX_BYTES) throw new Error('The provider response exceeds the 4 MB limit.');
  const script = html.match(/<script\b[^>]*\bid\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i);
  if (!script) throw new Error('The provider did not include its complete MVP data. No displayed-table rounding or missing values will be guessed.');
  let next;
  try { next = JSON.parse(script[1]); } catch (_) { throw new Error('The provider returned invalid MVP JSON.'); }
  const props = pavilionObject_(next) && pavilionObject_(next.props);
  const page = props && (pavilionObject_(props.appPageProps) || pavilionObject_(props.pageProps));
  const data = page && pavilionObject_(page.data);
  const series = data && pavilionObject_(data.series);
  if (!series || pavilionId_(series.objectId) !== source.seriesId) throw new Error('The returned series does not match the configured source.');
  const stats = data && pavilionObject_(data.content) && pavilionObject_(data.content.smartStats);
  if (!stats || !Array.isArray(stats.results) || !stats.results.length || stats.results.length > PAVILION_MAX_PLAYERS || pavilionNumber_(stats.total, false, true, true) !== stats.results.length) throw new Error('The provider returned an empty or incomplete MVP table.');
  const ids = new Set();
  const rows = stats.results.map(function(entry) {
    const row = pavilionObject_(entry);
    const player = row && pavilionObject_(row.player);
    const id = player && pavilionId_(player.objectId);
    const name = player && pavilionName_(player.longName);
    if (!row || row.type !== 'SERIES' || !id || !name || ids.has(id)) throw new Error('The MVP table contains an invalid or duplicate player identity.');
    ids.add(id);
    const team = pavilionObject_(row.team);
    return [id, name, pavilionNumber_(row.totalImpact, true, false, true),
      pavilionNumber_(row.matches, false, true, false), pavilionNumber_(row.runs, false, true, false), pavilionNumber_(row.wickets, false, true, false),
      team ? pavilionName_(team.longName) || '' : '', pavilionNumber_(row.battingImpact, true, false, false), pavilionNumber_(row.bowlingImpact, true, false, false)];
  });
  return { sourceUrl: source.canonicalUrl, seriesName: pavilionName_(series.seoName) || pavilionName_(series.longName) || source.seriesId, capturedAt: capturedAt, rows: rows };
}

function pavilionSafeCell_(value) {
  if (typeof value !== 'string') return value;
  // Google treats a leading '=' as a formula; the wider prefix set also protects
  // downstream CSV consumers. Numbers (including negative impact) stay numeric.
  return /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
}

function pavilionWriteFeed_(feed, snapshot) {
  const rowCount = snapshot.rows.length;
  const oldRows = feed.getLastRow();
  if (oldRows > PAVILION_MAX_PLAYERS + 1) throw new Error('The managed feed has unexpected extra rows. Move those rows to another tab first.');
  const values = [PAVILION_HEADERS.slice()].concat(snapshot.rows.map(function(row) {
    return row.concat([snapshot.sourceUrl, snapshot.capturedAt, rowCount]).map(pavilionSafeCell_);
  }));
  // Clear any previous longer feed in the SAME batch. Never clear working data
  // before a complete, validated replacement is ready.
  while (values.length < oldRows) values.push(PAVILION_HEADERS.map(function() { return ''; }));
  const additional = values.length - feed.getMaxRows();
  if (additional > 0) feed.insertRowsAfter(feed.getMaxRows(), additional);
  feed.getRange(2, 1, rowCount, 1).setNumberFormat('@');
  feed.getRange(2, 10, rowCount, 2).setNumberFormat('@');
  feed.getRange(1, 1, values.length, PAVILION_HEADERS.length).setValues(values);
}

function pavilionFormatFeed_(feed) {
  feed.setFrozenRows(1);
  feed.getRange(1, 1, 1, PAVILION_HEADERS.length).setBackground('#101c2b').setFontColor('#ffffff').setFontWeight('bold');
  feed.setColumnWidth(1, 110).setColumnWidth(2, 200).setColumnWidth(7, 230).setColumnWidth(10, 470).setColumnWidth(11, 220).setColumnWidth(12, 150);
  feed.getRange(2, 1, Math.max(1, feed.getMaxRows() - 1), 1).setNumberFormat('@');
  feed.getRange(2, 3, Math.max(1, feed.getMaxRows() - 1), 1).setNumberFormat('0.######');
  feed.getRange(2, 8, Math.max(1, feed.getMaxRows() - 1), 2).setNumberFormat('0.######');
  feed.getRange(2, 10, Math.max(1, feed.getMaxRows() - 1), 2).setNumberFormat('@');
}
