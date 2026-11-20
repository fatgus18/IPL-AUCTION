import test from 'node:test';
import assert from 'node:assert/strict';
import { workerConfiguration, workerRequest, processNextJob } from '../scripts/season-source-worker.mjs';
import { SeasonSourceError } from '../lib/season-source.ts';

const token = 'worker-test-secret-'.repeat(3);
const configuration = { origin: 'https://pavilion.example', token };
const sourceUrl = 'https://www.cricinfo.com/series/ipl-2026-1510719/most-valuable-players';
const time = Date.parse('2026-11-20T07:00:00.000Z');
const job = { id: 'job-123', leaseToken: 'a'.repeat(64), sourceUrl, claimedAt: new Date(time).toISOString(), leaseExpiresAt: new Date(time + 25000).toISOString() };

test('worker configuration rejects credential-bearing origins and non-local insecure HTTP', () => {
  assert.deepEqual(workerConfiguration({ PAVILION_WORKER_ORIGIN: configuration.origin, PAVILION_SOURCE_WORKER_TOKEN: token }), configuration);
  assert.equal(workerConfiguration({ PAVILION_WORKER_ORIGIN: 'http://127.0.0.1:3099', PAVILION_SOURCE_WORKER_TOKEN: token }).origin, 'http://127.0.0.1:3099');
  for (const origin of ['http://external.example', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?token=secret']) {
    assert.throws(() => workerConfiguration({ PAVILION_WORKER_ORIGIN: origin, PAVILION_SOURCE_WORKER_TOKEN: token }));
  }
  assert.throws(() => workerConfiguration({ PAVILION_WORKER_ORIGIN: configuration.origin, PAVILION_SOURCE_WORKER_TOKEN: 'short' }));
});

test('service credential is never forwarded through an HTTP redirect', async () => {
  let calls = 0;
  await assert.rejects(workerRequest(configuration, { type: 'claim' }, async (url, options) => {
    calls++;
    assert.equal(url, `${configuration.origin}/api/season-source-worker`);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return new Response(null, { status: 307, headers: { location: 'https://attacker.example/' } });
  }), /not forwarded/);
  assert.equal(calls, 1);
});

test('invalid credentials stop retries and do not echo the secret', async () => {
  await assert.rejects(workerRequest(configuration, { type: 'claim' }, async () => new Response('denied', { status: 401 })), error => error.code === 'WORKER_AUTH' && !error.message.includes(token));
});

test('unsafe or expired jobs never reach the source fetcher', async () => {
  for (const changes of [{ sourceUrl: 'http://127.0.0.1/private' }, { sourceUrl: `${sourceUrl}?private=value` }, { leaseExpiresAt: new Date(time - 1).toISOString() }, { leaseToken: 'short' }]) {
    let sourceCalls = 0;
    await assert.rejects(processNextJob(configuration, { request: async () => ({ job: { ...job, ...changes } }), now: () => time, fetchSource: async () => { sourceCalls++; } }));
    assert.equal(sourceCalls, 0);
  }
});

test('a fresh source result is submitted with the current lease, original timestamp and all signed points', async () => {
  const snapshot = { sourceUrl, provider: 'espncricinfo', seriesId: '1510719', seriesName: 'IPL 2026', fetchedAt: new Date(time + 500).toISOString(), rows: [{ providerPlayerId: '1408688', name: 'Vaibhav Sooryavanshi', points: 1012.29 }, { providerPlayerId: '1403153', name: 'Arshin Kulkarni', points: -31.54 }] };
  const calls = [];
  assert.equal(await processNextJob(configuration, { request: async body => { calls.push(body); return body.type === 'claim' ? { job } : { accepted: true }; }, now: () => time + 1000, fetchSource: async source => { assert.equal(source, sourceUrl); return snapshot; }, log: () => {} }), true);
  assert.deepEqual(calls[1], { type: 'complete', jobId: job.id, leaseToken: job.leaseToken, snapshot, totalRows: 2 });
});

test('provider failure submits a failed job rather than old or fabricated points', async () => {
  const calls = [];
  await processNextJob(configuration, { request: async body => { calls.push(body); return body.type === 'claim' ? { job } : { accepted: true }; }, now: () => time, fetchSource: async () => { throw new SeasonSourceError('ESPN returned HTTP 403.', 502, 'SEASON_SOURCE_UNAVAILABLE'); }, log: () => {} });
  assert.equal(calls[1].type, 'fail');
  assert.equal(calls[1].error.message, 'ESPN returned HTTP 403.');
  assert.equal(calls.some(call => call.type === 'complete'), false);
});

test('results that finish after their lease expires are not submitted', async () => {
  let current = time;
  const calls = [];
  await assert.rejects(processNextJob(configuration, { request: async body => { calls.push(body); return { job }; }, now: () => current, fetchSource: async () => { current += 26000; return { rows: [] }; }, log: () => {} }), /expired/);
  assert.equal(calls.length, 1);
});
