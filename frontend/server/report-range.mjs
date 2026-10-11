import { activateControl } from './controls.mjs';

export function validateRange(range) {
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!range || !validDate(range.from) || !validDate(range.to)) throw new Error('Alege două date valide pentru export.');
  if (range.from > range.to) throw new Error('Data de început trebuie să fie înainte de data de sfârșit.');
  return { from: range.from, to: range.to };
}

export class RangeSelectionError extends Error {}

async function dateInput(page, start) {
  const label = start ? /start date|from date|^from$|data de început|data de inceput|de la/i
    : /end date|to date|^to$|through|data de sfârșit|data de sfarsit|până la|pana la/i;
  const attributes = start ? 'start|from|begin' : 'end|through|to';
  const candidates = page.locator('input');
  const found = [];
  for (const input of await candidates.all()) {
    if (!await input.isVisible() || await input.evaluate(element => element.tagName !== 'INPUT')) continue;
    const meta = await input.evaluate(element => ({ type: element.type, name: `${element.name} ${element.id}`, label: `${element.getAttribute('aria-label') || ''} ${element.placeholder} ${[...element.labels || []].map(label => label.textContent).join(' ')}` }));
    if (['password', 'email', 'hidden', 'checkbox', 'radio'].includes(meta.type)) continue;
    if (label.test(meta.label.trim()) || new RegExp(`(?:^|[^a-z])(?:${attributes})(?:date|[^a-z]|$)`, 'i').test(meta.name)) found.push(input);
  }
  return found.length === 1 ? found[0] : null;
}

function dateFormat(value, placeholder, type) {
  if (type === 'date' || /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(value) || /yyyy.*mm.*dd/i.test(placeholder)) return 'ymd';
  if (/dd.*mm.*yyyy/i.test(placeholder)) return 'dmy';
  return 'mdy'; // The controlled browser uses en-US; explicit placeholders take priority.
}

function formatted(date, format, separator) {
  const [year, month, day] = date.split('-');
  return (format === 'ymd' ? [year, month, day] : format === 'dmy' ? [day, month, year] : [month, day, year]).join(separator);
}

function datePattern(date, format) {
  const [year, month, day] = date.split('-');
  const parts = { y: `(?:${year}|${year.slice(-2)})`, m: `0?${Number(month)}`, d: `0?${Number(day)}` };
  return [...format].map(part => parts[part]).join('[/.-]');
}

function rangePattern(range) {
  return new RegExp(`(?:^|[^0-9])(?:${['mdy', 'dmy', 'ymd'].map(format => `${datePattern(range.from, format)}\\s*[-–—]\\s*${datePattern(range.to, format)}`).join('|')})(?![0-9])`);
}

const ACTION_TIMEOUT = 5000;
const action = { timeout: ACTION_TIMEOUT };

async function selectCalendarDate(calendar, date, progress, background) {
  const [year, month, day] = date.split('-').map(Number);
  progress('alegerea anului');
  await activateControl(calendar.locator('.mat-legacy-calendar-period-button, .mat-calendar-period-button'), { background });
  const years = calendar.locator('mat-legacy-multi-year-view, mat-multi-year-view');
  await years.waitFor({ state: 'visible', ...action });
  let yearButton;
  for (let step = 0; step < 10; step++) {
    yearButton = years.getByRole('button', { name: String(year), exact: true });
    if (await yearButton.isVisible()) break;
    const displayed = (await years.getByRole('button').allTextContents()).map(text => Number(text.trim())).filter(value => value >= 1900);
    if (!displayed.length) throw new Error('Calendarul nu afișează anii.');
    const direction = year < Math.min(...displayed) ? 'previous' : 'next';
    const move = calendar.locator(`.mat-legacy-calendar-${direction}-button, .mat-calendar-${direction}-button`);
    if (!await move.isEnabled(action)) throw new Error('Anul este indisponibil.');
    await activateControl(move, { background });
  }
  if (!await yearButton.isVisible() || !await yearButton.isEnabled(action)) throw new Error('An indisponibil.');
  await activateControl(yearButton, { background });
  progress('alegerea lunii');
  const months = calendar.locator('mat-legacy-year-view, mat-year-view');
  await months.waitFor({ state: 'visible', ...action });
  const monthDate = new Date(Date.UTC(year, month - 1, 1));
  const names = ['long', 'short'].map(length => monthDate.toLocaleString('en-US', { month: length, timeZone: 'UTC' }));
  // Match visible month text too: the site's adapter can localize aria-label independently.
  const monthButton = months.getByRole('button', { name: new RegExp(`^(?:${names.join('|')})(?:\\s+${year})?$`, 'i') })
    .or(months.locator('button').filter({ hasText: new RegExp(`^\\s*(?:${names.join('|')})\\s*$`, 'i') })).first();
  if (!await monthButton.isEnabled(action)) throw new Error('Lună indisponibilă.');
  await activateControl(monthButton, { background });
  progress('alegerea zilei');
  const days = calendar.locator('mat-legacy-month-view, mat-month-view');
  await days.waitFor({ state: 'visible', ...action });
  // The year and month were explicitly selected. Numeric day text avoids parsing
  // country-specific accessibility labels with JavaScript's US date parser.
  const button = days.locator('button').filter({ hasText: new RegExp(`^\\s*${day}\\s*$`) });
  await button.waitFor({ state: 'visible', ...action });
  if (!await button.isEnabled(action) || await button.getAttribute('aria-disabled', action) === 'true') throw new RangeSelectionError(`Data ${date.split('-').reverse().join('.')} nu este disponibilă în CareLink.`);
  await activateControl(button, { background });
  // Angular commits selection asynchronously; wait before reopening the year view.
  await button.and(days.locator('[aria-pressed="true"]')).waitFor({ state: 'visible', ...action });
}

async function setCarelinkCalendarRange(page, range, trigger, onProgress, background) {
  let stage = 'încărcarea selectorului de perioadă';
  const progress = value => { stage = value; onProgress(`CareLink: ${value}…`); };
  try {
    progress(stage);
    await trigger.and(page.locator(':not(:disabled):not([aria-disabled="true"])')).waitFor({ state: 'visible', timeout: 12000 });
    progress('apăsarea selectorului de perioadă');
    await activateControl(trigger, { background });
    progress('afișarea calendarului');
    const calendar = page.locator('mat-legacy-datepicker-content mat-legacy-calendar, mat-datepicker-content mat-calendar').filter({ visible: true }).first();
    await calendar.waitFor({ state: 'visible', ...action });
    await selectCalendarDate(calendar, range.from, step => progress(`${step} de început`), background);
    await selectCalendarDate(calendar, range.to, step => progress(`${step} de sfârșit`), background);
    progress('aplicarea perioadei');
    const apply = page.locator('#date-range-apply').filter({ visible: true });
    if (!await apply.isEnabled(action)) throw new Error('Intervalul nu poate fi aplicat.');
    await activateControl(apply, { background });
    await calendar.waitFor({ state: 'hidden', ...action });
    progress('confirmarea perioadei în Reports');
    // Reports is authoritative. Hidden inputs use the country's date format,
    // even with English UI, and can differ from the period accepted by Reports.
    const committed = page.locator('#r-reporting-period-picker-text');
    await committed.filter({ hasText: rangePattern(range) }).waitFor({ state: 'visible', ...action });
  } catch (error) {
    const cancel = page.locator('#date-range-cancel').filter({ visible: true });
    if (await cancel.isVisible()) await activateControl(cancel, { background }).catch(() => {});
    throw new RangeSelectionError(`Calendarul CareLink nu a confirmat intervalul cerut. Pas nereușit: ${stage}.${error instanceof RangeSelectionError ? ` ${error.message}` : ''} Exportul nu a fost pornit.`);
  }
}

// Only export after the selected reporting period has been confirmed.
export async function setReportRange(page, range, { onProgress = () => {}, background = false } = {}) {
  validateRange(range);
  const calendarTrigger = page.locator('app-reporting-period lib-date-range-picker #date-range-button').filter({ visible: true });
  if (await calendarTrigger.count() === 1) {
    await setCarelinkCalendarRange(page, range, calendarTrigger, onProgress, background);
    return;
  }
  let from = await dateInput(page, true), to = await dateInput(page, false);
  if (!from || !to) {
    const custom = page.getByRole('button', { name: /custom.*(?:date|range)|interval personalizat/i }).first();
    if (await custom.isVisible()) await activateControl(custom, { background });
    from = await dateInput(page, true); to = await dateInput(page, false);
  }
  if (!from || !to) throw new RangeSelectionError('Nu am identificat câmpurile perioadei în CareLink. Exportul nu a fost pornit. Poți selecta perioada și descărca CSV-ul în fereastra CareLink.');
  const expected = [];
  try {
    for (const [input, date] of [[from, range.from], [to, range.to]]) {
      const meta = await input.evaluate(element => ({ value: element.value, placeholder: element.placeholder, type: element.type }));
      const format = dateFormat(meta.value, meta.placeholder, meta.type);
      const separator = meta.type === 'date' ? '-' : /\//.test(meta.value || meta.placeholder) || format !== 'ymd' ? '/' : '-';
      const value = formatted(date, format, separator);
      await input.fill(value, action);
      await input.press('Tab', action);
      expected.push(value);
    }
    const apply = page.getByRole('button', { name: /^(apply|apply dates|apply range|aplică|aplica)$/i }).first();
    if (await apply.isVisible()) await activateControl(apply, { background });
    if ((await from.inputValue()).trim() !== expected[0] || (await to.inputValue()).trim() !== expected[1]) throw new Error('Datele nu au fost confirmate.');
  } catch {
    throw new RangeSelectionError('CareLink nu a acceptat perioada selectată. Exportul nu a fost pornit. Verifică perioada în fereastra CareLink.');
  }
}
