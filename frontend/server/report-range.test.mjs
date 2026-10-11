import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions, CareLinkSession } from './carelink.mjs';
import { setReportRange, validateRange, RangeSelectionError } from './report-range.mjs';
import { recentRange, lastCompletedDay } from '../src/range-dates.js';
import { readFile } from 'node:fs/promises';

test('range validation rejects invalid dates and reverse intervals', () => {
  for (const range of [null, {}, { from: '2026-02-30', to: '2026-03-01' }, { from: '2026-09-01', to: '2026-08-01' }]) {
    assert.throws(() => validateRange(range));
  }
  assert.deepEqual(validateRange({ from: '2026-08-01', to: '2026-08-31' }), { from: '2026-08-01', to: '2026-08-31' });
});

test('date adapter confirms fields and declines unsupported or rejected controls', async t => {
  const browser = await chromium.launch(browserOptions({ headless: true }));
  t.after(() => browser.close());
  const page = await browser.newPage();
  const range = { from: '2026-08-01', to: '2026-08-31' };
  await page.setContent('<label>From<input type="date"></label><label>To<input type="date"></label>');
  await setReportRange(page, range);
  assert.equal(await page.getByLabel('From', { exact: true }).inputValue(), range.from);
  assert.equal(await page.getByLabel('To', { exact: true }).inputValue(), range.to);
  await page.setContent('<input aria-label="Start date" placeholder="DD/MM/YYYY"><input aria-label="End date" placeholder="DD/MM/YYYY">');
  await setReportRange(page, range);
  assert.equal(await page.getByLabel('Start date').inputValue(), '01/08/2026');
  assert.equal(await page.getByLabel('End date').inputValue(), '31/08/2026');
  await page.setContent('<p>Unrecognized date picker</p>');
  await assert.rejects(setReportRange(page, range), RangeSelectionError);
  await page.setContent('<label>From<input type="date" id="from"></label><label>To<input type="date"></label><button onclick="document.querySelector(\'#from\').value=\'2026-10-01\'">Apply</button>');
  await assert.rejects(setReportRange(page, range), /nu a acceptat/);
});

test('CareLink calendar selects a cross-month range through year/month/day and Apply', async t => {
  const browser = await chromium.launch(browserOptions({ headless: true }));
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(await readFile(new URL('./fixtures/carelink-calendar.html', import.meta.url), 'utf8'));
  await page.evaluate(() => { window.selectionDelay = 100; });
  const progress = [];
  await setReportRange(page, { from: '2026-08-01', to: '2026-10-10' }, { onProgress: step => progress.push(step) });
  assert.ok(progress.includes('CareLink: confirmarea perioadei în Reports…'));
  assert.equal(await page.locator('#r-reporting-period-picker-text').textContent(), '1/8/2026 - 10/10/2026');
  assert.deepEqual(await page.evaluate(() => window.steps.filter(([kind]) => ['date', 'apply'].includes(kind))),
    [['date', '2026-08-01'], ['date', '2026-10-10'], ['apply']]);
  assert.deepEqual(await page.locator('input[formcontrolname="start"]').evaluate(input => {
    const box = input.parentElement.getBoundingClientRect();
    return [box.width, box.height];
  }), [0, 0]);
  // A single-day period still needs two calendar selections.
  await setReportRange(page, { from: '2025-12-15', to: '2025-12-15' });
  assert.equal(await page.locator('#r-reporting-period-picker-text').textContent(), '15/12/2025 - 15/12/2025');
});

test('CareLink calendar rejects disabled days and periods silently shortened by the provider', async t => {
  const browser = await chromium.launch(browserOptions({ headless: true }));
  t.after(() => browser.close());
  const page = await browser.newPage();
  const fixture = await readFile(new URL('./fixtures/carelink-calendar.html', import.meta.url), 'utf8');
  await page.setContent(fixture);
  await page.evaluate(() => { window.unavailableDate = '2026-08-31'; });
  const range = { from: '2026-08-01', to: '2026-08-31' };
  await assert.rejects(setReportRange(page, range), /Pas nereușit: alegerea zilei de sfârșit/);
  assert.equal(await page.locator('input[formcontrolname="start"]').inputValue(), '1/10/2026');
  assert.equal(await page.locator('mat-legacy-datepicker-content').isVisible(), false);
  const clampedPage = await browser.newPage();
  await clampedPage.setContent(fixture);
  await clampedPage.evaluate(() => { window.clampEnd = true; });
  await assert.rejects(setReportRange(clampedPage, range), /Pas nereușit: confirmarea perioadei în Reports/);
  assert.equal(await clampedPage.locator('#r-reporting-period-picker-text').textContent(), '1/8/2026 - 30/8/2026');
});

test('all quick periods avoid an unavailable current day, while custom dates remain exact', async t => {
  const browser = await chromium.launch(browserOptions({ headless: true }));
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(await readFile(new URL('./fixtures/carelink-calendar.html', import.meta.url), 'utf8'));
  await page.evaluate(() => { window.unavailableDate = '2026-10-11'; });
  const today = '2026-10-11';
  const end = lastCompletedDay(today);
  for (const range of [recentRange(end, 30), recentRange(end, 7), { from: '2026-10-01', to: end }]) {
    await setReportRange(page, range, { background: true });
    assert.equal(await page.locator('#r-reporting-period-picker-text').textContent(), `${Number(range.from.slice(8))}/${Number(range.from.slice(5, 7))}/2026 - 10/10/2026`);
  }
  await assert.rejects(setReportRange(page, { from: '2026-10-01', to: today }, { background: true }), /Data 11\.10\.2026 nu este disponibilă/);
});

test('controlled session selects the requested dates, downloads CSV and retains earlier history', async t => {
  const browser = await chromium.launch(browserOptions({ headless: true }));
  t.after(() => browser.close());
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const fixture = await readFile(new URL('./fixtures/carelink-calendar.html', import.meta.url), 'utf8');
  const reports = fixture + `
    <style>@keyframes moving { from { transform:translateX(0); } to { transform:translateX(50px); } }
    button { animation:moving 100ms infinite alternate linear; }</style>
    <button id="p-button-export-reports-all-data" onclick="window.wrongExport = true">Data Export (CSV)</button>
    <button id="p-button-export-reports" onclick="
      const [d, m, y] = document.querySelector('input[formcontrolname=start]').value.split('/');
      window.location.href = '/export.csv?from=' + [y, m.padStart(2, '0'), d.padStart(2, '0')].join('-');
    ">Data Export (CSV)</button>`;
  await page.route('https://carelink.minimed.eu/**', route => route.fulfill({ contentType: 'text/html',
    body: new URL(route.request().url()).pathname === '/app/reports' ? reports : '<main>Dashboard without a Reports link</main>' }));
  await page.route('https://carelink.minimed.eu/export.csv?*', route => {
    const fields = Array(54).fill('');
    fields[1] = new URL(route.request().url()).searchParams.get('from').replaceAll('-', '/');
    fields[2] = '12:00:00'; fields[34] = '110';
    return route.fulfill({ headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="report.csv"' },
      body: `header\n---;Sensor;---\ncolumns\n${fields.join(';')}` });
  });
  await page.goto('https://carelink.minimed.eu/app/dashboard');
  const session = new CareLinkSession();
  session.browser = browser; session.context = context; session.page = page; session.authenticated = true;
  session.windowBackgrounded = true;
  session.addEntries([{ date: '2026-10-10', time: '12:00:00', bg: 150, event: 'NONE' }]);
  page.on('download', download => session.consumeDownload(download, session.generation));
  // Even after returning to Dashboard, sync must open Reports itself.
  await session.sync({ from: '2026-08-01', to: '2026-08-31' });
  await session.downloadQueue;
  assert.equal(session.state, 'ready');
  assert.equal(page.url(), 'https://carelink.minimed.eu/app/reports');
  assert.equal(await page.evaluate(() => Boolean(window.wrongExport)), false);
  assert.deepEqual(session.entries.map(entry => entry.date), ['2026-08-01', '2026-10-10']);
  assert.deepEqual(session.status().requestedRange, { from: '2026-08-01', to: '2026-08-31' });
  await page.setContent('<button onclick="window.exportClicked = true">Data Export (CSV)</button>');
  await session.sync({ from: '2026-07-01', to: '2026-07-31' });
  assert.equal(session.state, 'awaiting_export');
  assert.equal(await page.evaluate(() => Boolean(window.exportClicked)), false);
  assert.equal(session.entries.length, 2);
});
