// Formatos en español rioplatense, siempre en la hora del local.
export const TZ = 'America/Argentina/Salta';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const clean = (s) => s.replace('.', '');

/** 10000 → '$ 10.000' */
export function price(ars) {
  return `$ ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(ars)}`;
}

/** 45 → '45 min', 90 → '1 h 30 min' */
export function duration(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** 'YYYY-MM-DD' de hoy en Salta */
export function todayStr(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Las fechas 'YYYY-MM-DD' se formatean a mediodía UTC para que ninguna zona cambie el día.
const noon = (dateStr) => new Date(`${dateStr}T12:00:00Z`);
const fmt = (opts) => new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', ...opts });

/** 'Jue 19 nov' */
export function shortDate(dateStr) {
  const d = noon(dateStr);
  return `${cap(clean(fmt({ weekday: 'short' }).format(d)))} ${fmt({ day: 'numeric' }).format(d)} ${clean(fmt({ month: 'short' }).format(d))}`;
}

/** 'jueves 19 de noviembre' */
export function longDate(dateStr) {
  return fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(noon(dateStr));
}

/** 'martes 24' */
export function weekdayAndDay(dateStr) {
  const d = noon(dateStr);
  return `${fmt({ weekday: 'long' }).format(d)} ${fmt({ day: 'numeric' }).format(d)}`;
}

/** Para la tira de días: { wd: 'JUE', n: '19' } */
export function dayChip(dateStr) {
  const d = noon(dateStr);
  return { wd: clean(fmt({ weekday: 'short' }).format(d)).toUpperCase(), n: fmt({ day: 'numeric' }).format(d) };
}

/** Rótulo relativo: 'Hoy', 'Mañana' o null */
export function relativeDay(dateStr, now = new Date()) {
  const t = todayStr(now);
  if (dateStr === t) return 'Hoy';
  if (dateStr === addDays(t, 1)) return 'Mañana';
  return null;
}

/** Nº de turno con 4 dígitos: 142 → 'Nº 0142' */
export function turnoNumber(n) {
  return `Nº ${String(n).padStart(4, '0')}`;
}

/** Archivo .ics para agregar el turno al calendario del celular */
export function icsFile({ title, startsAt, endsAt, location, url }) {
  const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s = '') => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Turnos Barberia//ES', 'BEGIN:VEVENT',
    `UID:${stamp(startsAt)}-${Math.random().toString(36).slice(2)}@turnos`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(startsAt)}`, `DTEND:${stamp(endsAt)}`,
    `SUMMARY:${esc(title)}`,
    location ? `LOCATION:${esc(location)}` : null,
    url ? `URL:${url}` : null,
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  return new Blob([body], { type: 'text/calendar;charset=utf-8' });
}
