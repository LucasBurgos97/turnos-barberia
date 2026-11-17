// Fechas: en la base todo es UTC (timestamptz). La "fecha local" y la "hora local"
// son siempre de la zona del local (America/Argentina/Salta).

const partsCache = new Map();
function formatter(tz) {
  if (!partsCache.has(tz)) {
    partsCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return partsCache.get(tz);
}

function zonedParts(date, tz) {
  return Object.fromEntries(formatter(tz).formatToParts(date).map((p) => [p.type, p.value]));
}

/** Diferencia en minutos entre la hora local de `tz` y UTC en ese instante (Salta: -180). */
export function tzOffsetMinutes(date, tz) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** 'YYYY-MM-DD' + minutos desde la medianoche local → instante UTC. */
export function zonedToUtc(dateStr, minutes, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const off = tzOffsetMinutes(new Date(guess), tz);
  let t = guess - off * 60000;
  const off2 = tzOffsetMinutes(new Date(t), tz);
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}

/** Instante → 'YYYY-MM-DD' en la zona del local. */
export function localDate(date, tz) {
  const p = zonedParts(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Instante → 'HH:MM' en la zona del local. */
export function localTime(date, tz) {
  const p = zonedParts(date, tz);
  return `${p.hour}:${p.minute}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado (igual que working_hours.weekday). */
export function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 'HH:MM' o 'HH:MM:SS' → minutos desde medianoche. */
export function timeToMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

export function isValidDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
