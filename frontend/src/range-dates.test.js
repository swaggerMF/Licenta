import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, localDate, europeanDate, monthDays, recentRange, lastCompletedDay } from './range-dates.js';

test('European range dates preserve local days and start calendar weeks on Monday', () => {
  assert.equal(europeanDate('2026-10-11'), '11.10.2026');
  assert.equal(dateKey(localDate('2026-10-11')), '2026-10-11');
  const days = monthDays(2024, 1);
  assert.equal(days.length, 42);
  assert.equal(days[0], '2024-01-29');
  assert.ok(days.includes('2024-02-29'));
  assert.equal(new Set(days).size, 42);
  assert.equal(localDate(days[0]).getDay(), 1);
  assert.deepEqual(recentRange('2026-03-31', 7), { from: '2026-03-25', to: '2026-03-31' });
  assert.deepEqual(recentRange('2026-01-03', 7), { from: '2025-12-28', to: '2026-01-03' });
});


test('quick periods use complete days across month, year and leap-day boundaries', () => {
  assert.deepEqual(recentRange(lastCompletedDay('2026-10-11'), 30), { from: '2026-09-11', to: '2026-10-10' });
  assert.deepEqual(recentRange(lastCompletedDay('2026-10-11'), 7), { from: '2026-10-04', to: '2026-10-10' });
  assert.equal(lastCompletedDay('2026-01-01'), '2025-12-31');
  assert.equal(lastCompletedDay('2024-03-01'), '2024-02-29');
  assert.equal(lastCompletedDay('2026-03-30'), '2026-03-29');
});
