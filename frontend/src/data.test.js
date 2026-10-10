import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chartSegments, glucoseColor, groupDays, mergeEntries, parseCsv, sensorReason, stats } from './data.js';

function row(date, time, bg, event = '') {
  const fields = Array(54).fill('');
  fields[1] = date; fields[2] = time; fields[34] = bg; fields[51] = event;
  return fields.join(';');
}
const csv = rows => ['ignored pump rows', '----;Sensor;----', 'column headers', ...rows].join('\r\n');

test('imports accumulate earlier months and deduplicate overlapping exports', () => {
  const september = { date: '2026-09-15', time: '12:00:00', bg: 110, event: 'NONE' };
  const october = { ...september, date: '2026-10-10', bg: 150 };
  const august = { ...september, date: '2026-08-15', bg: 100 };
  const original = [october, september];
  const combined = mergeEntries(original, [august, september]);
  assert.deepEqual(combined, [august, september, october]);
  assert.deepEqual(mergeEntries(combined, [august, september, october]), combined);
  assert.deepEqual(original, [october, september]);
  assert.equal(stats(combined).count, 3);
});

test('overlaps keep sensor reasons and use new valid values without erasing existing glucose', () => {
  const reading = { date: '2026-10-10', time: '12:00:00', bg: 120, event: 'NONE' };
  const missing = { ...reading, bg: null };
  const reason = { ...missing, event: 'SENSOR_ERROR' };
  assert.deepEqual(mergeEntries([reading], [missing, reason, reason]), [reading, reason]);
  assert.deepEqual(mergeEntries([missing], [reading]), [reading]);
  assert.deepEqual(mergeEntries([reading], [{ ...reading, bg: 125 }]), [{ ...reading, bg: 125 }]);
});

test('statistics handle a long history without spreading all values into function arguments', () => {
  assert.deepEqual(stats(Array.from({ length: 200000 }, (_, index) => ({ bg: index % 2 ? null : 120 }))),
    { mean: 120, min: 120, max: 120, count: 100000 });
});

test('parses sensor rows, validates dates, and preserves local day boundaries', () => {
  const entries = parseCsv(csv([
    row('2026/10/10', '00:00:00', '120'),
    row('2026/10/09', '23:59:59', '99', 'SENSOR_EVENT'),
    row('2026/02/30', '12:00:00', '110'),
    row('2026/10/10', '24:00:00', '110'),
    row('2026/10/10', '12:00:00', '-1'),
    row('2026/10/10', '12:00:00', ''),
  ]));
  assert.deepEqual(entries, [
    { date: '2026-10-10', time: '00:00:00', bg: 120, event: 'NONE' },
    { date: '2026-10-09', time: '23:59:59', bg: 99, event: 'SENSOR_EVENT' },
    { date: '2026-10-10', time: '12:00:00', bg: null, event: 'NONE' },
  ]);
  assert.equal(groupDays(entries).size, 2);
});

test('preserves missing values and reasons, excludes them from statistics and breaks the line', () => {
  const day = groupDays(parseCsv(csv([
    row('2026/10/10', '12:00:00', '100'),
    row('2026/10/10', '12:05:00', '', 'SENSOR_ERROR'),
    row('2026/10/10', '12:10:00', '140'),
  ]))).get('2026-10-10');
  assert.equal(day[1].bg, null);
  assert.match(sensorReason(day[1]), /Eroare senzor.*SENSOR_ERROR/);
  assert.deepEqual(stats(day), { mean: 120, min: 100, max: 140, count: 2 });
  assert.deepEqual(chartSegments(day).map(segment => segment.length), [1, 1]);
  assert.equal(stats([day[1]]), null);
  assert.deepEqual(chartSegments([day[1]]), []);
  assert.equal(sensorReason({ bg: null, event: 'NONE' }), 'Motiv nespecificat în CSV');
  assert.equal(sensorReason({ bg: null, event: 'NEW_SENSOR_CODE' }), 'NEW_SENSOR_CODE');
});

test('colors threshold boundaries inclusively and handles missing values separately', () => {
  assert.equal(glucoseColor(69), '#dc4444');
  assert.equal(glucoseColor(70), '#155e52');
  assert.equal(glucoseColor(180), '#155e52');
  assert.equal(glucoseColor(181), '#c89916');
  assert.equal(glucoseColor(null), '#87938d');
});

test('groups and sorts reverse-chronological sensor readings, leaving gaps', () => {
  const entries = parseCsv(csv([row('2026/10/10', '14:00:00', '140'), row('2026/10/10', '12:05:00', '110'), row('2026/10/10', '12:00:00', '100')]));
  const day = groupDays(entries).get('2026-10-10');
  assert.deepEqual(day.map(entry => entry.bg), [100, 110, 140]);
  assert.deepEqual(chartSegments(day).map(segment => segment.length), [2, 1]);
  assert.deepEqual(stats(day), { mean: 117, min: 100, max: 140, count: 3 });
  assert.equal(stats([]), null);
});

test('reports missing sensor section and empty files', () => {
  assert.throws(() => parseCsv(''), /Sensor/);
  assert.throws(() => parseCsv(csv([])), /valide/);
});

test('browser CSV import agrees with actual C++ JSON export when local data exists', t => {
  let text, exported;
  try {
    text = readFileSync(new URL('../../in.csv', import.meta.url), 'utf8');
    exported = JSON.parse(readFileSync(new URL('../public/data.json', import.meta.url), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return t.skip('No local CSV/export available');
    throw error;
  }
  assert.deepEqual(parseCsv(text), exported);
});
