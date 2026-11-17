// Webhook de Meta: estados de entrega de los mensajes (enviado → entregado → leído, o falló).
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Valida X-Hub-Signature-256 (HMAC-SHA256 del cuerpo crudo con el App Secret). */
export function verifySignature(rawBody, header, appSecret) {
  if (!rawBody || !header?.startsWith('sha256=') || !appSecret) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const got = Buffer.from(header.slice(7));
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const RANK = { sent: 1, delivered: 2, read: 3 };

/** Aplica los estados que trae el webhook. Nunca "baja" un estado (leído no vuelve a entregado). */
export async function applyStatuses(db, body) {
  let updated = 0;
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const st of change.value?.statuses ?? []) {
        if (!st.id) continue;
        if (st.status === 'failed') {
          const err = st.errors?.[0];
          const msg = err ? `${err.title ?? 'Error'}${err.error_data?.details ? `: ${err.error_data.details}` : ''} (${err.code})` : 'Falló el envío';
          const { rows } = await db.query(`
            update notifications set status = 'failed', error = $2
             where provider_message_id = $1 and status <> 'read' returning id`, [st.id, msg]);
          updated += rows.length;
        } else if (RANK[st.status]) {
          const { rows } = await db.query(`
            update notifications set status = $2::notification_status
             where provider_message_id = $1
               and (case status when 'sending' then 0 when 'sent' then 1 when 'delivered' then 2
                                when 'read' then 3 else 99 end) < $3
             returning id`, [st.id, st.status, RANK[st.status]]);
          updated += rows.length;
        }
      }
    }
  }
  return updated;
}
