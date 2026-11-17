// Plantillas de WhatsApp. El TEXTO se carga y aprueba en Meta (WhatsApp Manager → Plantillas),
// categoría "Utility", idioma "Spanish (ARG)" / es_AR. Acá solo se arman los parámetros {{n}},
// en el mismo orden que el texto aprobado. Ver docs/whatsapp.md.
import { addDays, localDate, localTime } from '../lib/time.js';

export const TEMPLATE_NAMES = {
  confirmation: 'turno_confirmado',
  reminder: 'turno_recordatorio',
  cancellation: 'turno_cancelado',
};

/** Textos para cargar en Meta (y para el plan B por wa.me). */
export const TEMPLATE_TEXTS = {
  turno_confirmado:
    'Hola {{1}}, tu turno en {{2}} quedó confirmado: {{3}} a las {{4}} con {{5}}. Si no podés venir, cancelalo acá: {{6}}',
  turno_recordatorio:
    'Hola {{1}}, te recordamos tu turno en {{2}}: {{3}} a las {{4}}. ¿No llegás? Cancelalo acá así el horario le sirve a otro: {{5}}',
  turno_cancelado:
    'Hola {{1}}, tu turno en {{2}} del {{3}} a las {{4}} quedó cancelado. Si querés sacar otro: {{5}}',
};

const WEEKDAY = new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', weekday: 'long' });
const DAYMONTH = new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', day: 'numeric', month: 'numeric' });

/** 'YYYY-MM-DD' → 'jueves 19/11' */
export function dayLabel(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return `${WEEKDAY.format(d)} ${DAYMONTH.format(d)}`;
}

/** Para el recordatorio: 'hoy', 'mañana' o 'el jueves 19/11' */
export function relativeDayLabel(dateStr, now, tz) {
  const today = localDate(now, tz);
  if (dateStr === today) return 'hoy';
  if (dateStr === addDays(today, 1)) return 'mañana';
  return `el ${dayLabel(dateStr)}`;
}

const firstName = (name) => name.trim().split(/\s+/)[0];

/**
 * @param {'confirmation'|'reminder'|'cancellation'} kind
 * @param {object} r  fila con: customer_name, shop_name, starts_at, barber_name, cancel_token, timezone
 * @param {{ webUrl: string, now: Date }} ctx
 * @returns {{ template: string, params: string[], text: string }}
 */
export function buildMessage(kind, r, { webUrl, now }) {
  const tz = r.timezone;
  const date = localDate(r.starts_at, tz);
  const time = localTime(r.starts_at, tz);
  const base = webUrl.replace(/\/$/, '');
  const manage = `${base}/t/${r.cancel_token}`;

  const template = TEMPLATE_NAMES[kind];
  let params;
  if (kind === 'confirmation') {
    params = [firstName(r.customer_name), r.shop_name, dayLabel(date), time, firstName(r.barber_name), manage];
  } else if (kind === 'reminder') {
    params = [firstName(r.customer_name), r.shop_name, relativeDayLabel(date, now, tz), time, manage];
  } else {
    params = [firstName(r.customer_name), r.shop_name, dayLabel(date), time, `${base}/`];
  }
  // WhatsApp rechaza parámetros vacíos o con saltos de línea
  params = params.map((p) => String(p ?? '-').replace(/\s*\n\s*/g, ' ').trim() || '-');
  const text = TEMPLATE_TEXTS[template].replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1]);
  return { template, params, text };
}
