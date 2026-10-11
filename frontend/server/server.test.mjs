import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from './index.mjs';
import { CareLinkSession } from './carelink.mjs';
import { parseCsvText } from './parser.mjs';
import { access, copyFile } from 'node:fs/promises';

const row = (bg, reason = '') => {
  const fields = Array(54).fill('');
  fields[1] = '2026/10/10'; fields[2] = '12:00:00'; fields[34] = bg; fields[51] = reason;
  return fields.join(';');
};
const csv = `header\n----;Sensor;----\ncolumns\n${row('120')}\n${row('', 'SENSOR_ERROR')}\n`;

test('runtime C++ parser preserves both glucose and missing-value reasons', async () => {
  assert.deepEqual(await parseCsvText(csv), [
    { date: '2026-10-10', time: '12:00:00', bg: 120, event: 'NONE' },
    { date: '2026-10-10', time: '12:00:00', bg: null, event: 'SENSOR_ERROR' },
  ]);
  await assert.rejects(parseCsvText('<html>Not a CSV</html>'), /Sensor/);
});

test('local API protects credentials/data and routes imports through C++', async t => {
  const connector = {
    state: 'idle', revision: 0, entries: [],
    status() { return { state: this.state, revision: this.revision }; },
    startLogin(body) { this.credentials = body; this.state = 'awaiting_login'; },
    async disconnect() { this.state = 'idle'; },
    addEntries: CareLinkSession.prototype.addEntries,
  };
  const app = createAppServer({ connector });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const initial = await fetch(`${base}/api/carelink/status`);
  assert.equal(initial.status, 200);
  const cookie = initial.headers.get('set-cookie').split(';')[0];
  assert.match(initial.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const headers = { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${base}/api/carelink/entries`)).status, 401);
  assert.equal((await fetch(`${base}/api/carelink/status`, { headers: { Cookie: `carelink_session=${'é'.repeat(64)}` } })).status, 401);
  assert.equal((await fetch(`${base}/api/carelink/login`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: JSON.stringify({ country: 'România' }) })).status, 403);
  assert.equal((await fetch(`${base}/api/carelink/login`, { method: 'POST', headers, body: JSON.stringify({ country: 'România', username: 'example', password: '' }) })).status, 400);
  const manualLogin = await fetch(`${base}/api/carelink/login`, { method: 'POST', headers, body: '{}' });
  assert.equal(manualLogin.status, 202);
  assert.equal(connector.credentials.country, undefined);
  const login = await fetch(`${base}/api/carelink/login`, { method: 'POST', headers, body: JSON.stringify({ country: 'România', username: 'example', password: 'test-secret' }) });
  assert.equal(login.status, 202);
  assert.equal(connector.credentials.country, 'România');
  assert.ok(!(await login.text()).includes('test-secret'));
  const imported = await fetch(`${base}/api/import`, { method: 'POST', headers, body: JSON.stringify({ csv }) });
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).entries[1].event, 'SENSOR_ERROR');
  const augustCsv = csv.replaceAll('2026/10/10', '2026/08/15');
  const earlier = await fetch(`${base}/api/import`, { method: 'POST', headers, body: JSON.stringify({ csv: augustCsv }) });
  assert.equal((await earlier.json()).entries.length, 4);
  await fetch(`${base}/api/import`, { method: 'POST', headers, body: JSON.stringify({ csv }) });
  const history = await fetch(`${base}/api/carelink/entries`, { headers });
  const accumulated = await history.json();
  assert.equal(accumulated.entries.length, 4);
  assert.equal(accumulated.importedLatest, '2026-10-10');
  const invalid = await fetch(`${base}/api/import`, { method: 'POST', headers, body: JSON.stringify({ csv: 'invalid' }) });
  assert.equal(invalid.status, 422);
  const disconnected = await fetch(`${base}/api/carelink/disconnect`, { method: 'POST', headers, body: '{}' });
  assert.equal((await disconnected.json()).state, 'idle');
});

test('a downloaded CSV updates the session and deletes its temporary file', async () => {
  let temporaryFile;
  const session = new CareLinkSession();
  const fixture = new URL('../.cache/download-fixture.csv', import.meta.url);
  const { writeFile, rm } = await import('node:fs/promises');
  await writeFile(fixture, csv);
  try {
    await session.consumeDownload({
      suggestedFilename: () => 'report.csv',
      saveAs: async filename => { temporaryFile = filename; await copyFile(fixture, filename); },
    }, session.generation);
    assert.equal(session.status().state, 'ready');
    assert.equal(session.revision, 1);
    assert.equal(session.entries.length, 2);
    await assert.rejects(access(temporaryFile));
    await session.disconnect();
    assert.equal(session.entries.length, 2);
  } finally { await rm(fixture, { force: true }); }
});

test('download failure and non-CSV files do not replace previous entries', async () => {
  const session = new CareLinkSession();
  session.entries = [{ bg: 100 }];
  await session.consumeDownload({ suggestedFilename: () => 'report.pdf' }, 0);
  assert.equal(session.state, 'idle');
  await session.consumeDownload({ suggestedFilename: () => 'report.csv', saveAs: async () => { throw new Error('Download failed'); } }, 0);
  assert.equal(session.state, 'error');
  assert.deepEqual(session.entries, [{ bg: 100 }]);
  assert.equal(session.revision, 0);
});

test('downloads arriving together are all processed and merged', async () => {
  let release;
  const firstParsing = new Promise(resolve => { release = resolve; });
  let parsingStarted;
  const started = new Promise(resolve => { parsingStarted = resolve; });
  let parsed = 0;
  const session = new CareLinkSession({ parseDownload: async () => {
    const index = parsed++;
    if (index === 0) { parsingStarted(); await firstParsing; }
    return [{ date: index === 0 ? '2026-10-10' : '2026-08-15', time: '12:00:00', bg: 120, event: 'NONE' }];
  } });
  const download = { suggestedFilename: () => 'report.csv', saveAs: async () => {} };
  const first = session.consumeDownload(download, session.generation);
  await started;
  const second = session.consumeDownload(download, session.generation);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(session.entries.map(entry => entry.date), ['2026-08-15', '2026-10-10']);
  assert.equal(session.revision, 2);
});

test('period API validates dates and passes the requested range to the authenticated session', async t => {
  const session = new CareLinkSession();
  session.context = {};
  session.authenticated = true;
  let requested;
  session.sync = async range => { requested = range; };
  const app = createAppServer({ connector: session });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const status = await fetch(`${base}/api/carelink/status`);
  const headers = { Origin: base, Cookie: status.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  const post = range => fetch(`${base}/api/carelink/sync`, { method: 'POST', headers, body: JSON.stringify({ range }) });
  assert.equal((await post({ from: '2026-02-30', to: '2026-03-01' })).status, 400);
  assert.equal((await post({ from: '2026-10-10', to: '2026-08-01' })).status, 400);
  assert.equal(requested, undefined);
  const range = { from: '2026-08-01', to: '2026-08-31' };
  assert.equal((await post(range)).status, 202);
  assert.deepEqual(requested, range);
  session.authenticated = false;
  assert.equal((await post(range)).status, 400);
});

test('disconnect while browser is launching prevents a stale login from reopening', async () => {
  let release, closed = false;
  const session = new CareLinkSession({ launch: () => new Promise(resolve => { release = resolve; }) });
  const credentials = { country: 'România', username: 'example', password: 'secret' };
  session.startLogin(credentials);
  await session.disconnect();
  release({ close: async () => { closed = true; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, true);
  assert.equal(session.state, 'idle');
  assert.equal(credentials.password, '');
});
