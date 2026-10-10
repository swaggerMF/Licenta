// Calendar dates stay in the CSV's local time, without timezone conversion.
export function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const start = lines.findIndex(line => line.includes(';Sensor;'));
  if (start < 0) throw new Error('Fișierul nu conține secțiunea Sensor.');
  const entries = [];
  for (const line of lines.slice(start + 2)) {
    const fields = line.split(';');
    if (fields.length < 52) continue;
    const date = fields[1].match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    const time = fields[2].match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (!date || !time || (fields[34] && !/^\d+$/.test(fields[34]))) continue;
    const [, year, month, day] = date.map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) continue;
    if (+time[1] > 23 || +time[2] > 59 || +time[3] > 59) continue;
    const bg = fields[34] ? Number(fields[34]) : null;
    if (bg !== null && (!Number.isSafeInteger(bg) || bg > 4294967295)) continue;
    entries.push({ date: fields[1].replaceAll('/', '-'), time: fields[2], bg, event: fields[51] || 'NONE' });
  }
  if (!entries.length) throw new Error('Nu au fost găsite măsurători valide în secțiunea Sensor.');
  return entries;
}

export function groupDays(entries) {
  const days = new Map();
  for (const entry of entries) {
    if (!days.has(entry.date)) days.set(entry.date, []);
    const [h, m, s] = entry.time.split(':').map(Number);
    days.get(entry.date).push({ ...entry, minute: h * 60 + m + s / 60 });
  }
  for (const readings of days.values()) readings.sort((a, b) => a.minute - b.minute);
  return days;
}

export function stats(entries) {
  const values = entries.filter(entry => entry.bg !== null).map(entry => entry.bg);
  if (!values.length) return null;
  return {
    mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    min: Math.min(...values), max: Math.max(...values), count: values.length,
  };
}

export function chartSegments(entries) {
  const segments = [];
  let interrupted = false;
  for (const entry of entries) {
    if (entry.bg === null) {
      interrupted = true;
      continue;
    }
    const last = segments.at(-1);
    // Preserve gaps: never imply continuous readings across missing sensor data.
    if (!last || interrupted || entry.minute - last.at(-1).minute > 15) segments.push([entry]);
    else last.push(entry);
    interrupted = false;
  }
  return segments;
}

export function sensorReason(entry) {
  const reasons = {
    SENSOR_INIT_CODE: 'Inițializare senzor',
    SENSOR_ERROR: 'Eroare senzor',
    SENSOR_END_OF_LIFE: 'Senzor ajuns la sfârșitul duratei de utilizare',
    SENSOR_CHANGE_SENSOR_ERROR: 'Eroare senzor — este necesară schimbarea',
  };
  if (!entry.event || entry.event === 'NONE') {
    return entry.bg === null ? 'Motiv nespecificat în CSV' : '—';
  }
  return reasons[entry.event] ? `${reasons[entry.event]} (${entry.event})` : entry.event;
}

export function glucoseColor(bg) {
  if (bg === null) return '#87938d';
  if (bg < 70) return '#dc4444';
  if (bg > 180) return '#c89916';
  return '#155e52';
}
