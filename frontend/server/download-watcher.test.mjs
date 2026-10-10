import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, rename, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DownloadWatcher } from './download-watcher.mjs';
import { CareLinkSession } from './carelink.mjs';

function csv(bg) {
  const fields = Array(54).fill('');
  fields[1] = '2026/10/10'; fields[2] = '12:00:00'; fields[34] = String(bg);
  return `header\n---;Sensor;---\ncolumns\n${fields.join(';')}\n`;
}

test('only new stable CareLink CSV downloads are imported; originals are untouched', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'carelink-watcher-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'old.csv'), csv(100));
  const received = [];
  const watcher = new DownloadWatcher({ directory, interval: 0, onEntries: entries => received.push(entries) });
  t.after(() => watcher.stop());
  await watcher.start();
  await watcher.scan();
  assert.equal(received.length, 0);
  const partial = path.join(directory, 'new.csv.crdownload');
  await writeFile(partial, csv(135));
  await watcher.scan();
  assert.equal(received.length, 0);
  const filename = path.join(directory, 'new.csv');
  await rename(partial, filename);
  await watcher.scan();
  assert.equal(received.length, 0);
  await watcher.scan();
  assert.equal(received.length, 1);
  assert.equal(received[0][0].bg, 135);
  assert.equal(await readFile(filename, 'utf8'), csv(135));
  await watcher.scan();
  assert.equal(received.length, 1);
  await writeFile(path.join(directory, 'unrelated.csv'), 'name,value\nexample,1');
  await watcher.scan(); await watcher.scan();
  assert.equal(received.length, 1);
  watcher.stop();
  await writeFile(path.join(directory, 'after-stop.csv'), csv(140));
  await watcher.scan();
  assert.equal(received.length, 1);
});

test('changing CSV files are deferred until stable', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'carelink-watcher-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const received = [];
  const watcher = new DownloadWatcher({ directory, interval: 0, onEntries: entries => received.push(entries) });
  t.after(() => watcher.stop());
  await watcher.start();
  const filename = path.join(directory, 'new.csv');
  await writeFile(filename, csv(90));
  await watcher.scan();
  await writeFile(filename, csv(1800));
  await watcher.scan();
  assert.equal(received.length, 0);
  await watcher.scan();
  assert.equal(received[0][0].bg, 1800);
});

test('normal-browser mode starts and stops watching without launching automation', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'carelink-normal-test-'));
  const previous = process.env.CARELINK_DOWNLOAD_DIR;
  process.env.CARELINK_DOWNLOAD_DIR = directory;
  const session = new CareLinkSession({ launch: () => { throw new Error('Must not launch Playwright'); } });
  t.after(async () => {
    await session.disconnect();
    if (previous === undefined) delete process.env.CARELINK_DOWNLOAD_DIR;
    else process.env.CARELINK_DOWNLOAD_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
  await session.startNormalLogin();
  assert.equal(session.status().mode, 'normal');
  assert.equal(session.state, 'awaiting_export');
  await writeFile(path.join(directory, 'export.csv'), csv(150));
  await session.sync(); await session.sync();
  assert.equal(session.state, 'ready');
  assert.equal(session.entries[0].bg, 150);
  await session.disconnect();
  assert.equal(session.watcher, null);
  assert.equal(session.state, 'idle');
});
