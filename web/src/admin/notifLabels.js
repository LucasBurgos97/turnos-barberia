export const KIND_LABEL = { confirmation: 'Confirmación', reminder: 'Recordatorio', cancellation: 'Aviso de cancelación' };

export const NOTIF_LABEL = {
  scheduled: 'Programado', sending: 'Enviando', sent: 'Enviado', delivered: 'Entregado',
  read: 'Leído', failed: 'Falló', skipped: 'No se envía',
};

export const NOTIF_TONE = {
  scheduled: '', sending: 'now', sent: 'ok', delivered: 'ok', read: 'ok', failed: 'danger', skipped: '',
};

/** Texto para mandar a mano por wa.me (plan B mientras Meta no aprueba las plantillas). */
export function manualText(kind, { firstName, shopName, dateLabel, time, link }) {
  if (kind === 'cancellation') return `Hola ${firstName}, tu turno en ${shopName} del ${dateLabel} a las ${time} quedó cancelado.`;
  if (kind === 'reminder') return `Hola ${firstName}, te recordamos tu turno en ${shopName}: ${dateLabel} a las ${time}. Si no podés venir, avisanos.`;
  return `Hola ${firstName}, tu turno en ${shopName} quedó confirmado: ${dateLabel} a las ${time}.${link ? ` Para verlo o cancelarlo: ${link}` : ''}`;
}

export const waLink = (phone, text) => `https://wa.me/${phone.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
