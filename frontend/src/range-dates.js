export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function localDate(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function europeanDate(key) {
  return key.split('-').reverse().join('.');
}

export function monthDays(year, month) {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => dateKey(new Date(year, month, index - offset + 1)));
}

export function recentRange(end, days) {
  const start = localDate(end);
  start.setDate(start.getDate() - days + 1);
  return { from: dateKey(start), to: end };
}

// Quick periods use complete days; today's upload may not be available yet.
export function lastCompletedDay(today) {
  const date = localDate(today);
  date.setDate(date.getDate() - 1);
  return dateKey(date);
}
