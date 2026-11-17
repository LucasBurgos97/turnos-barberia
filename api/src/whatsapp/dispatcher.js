// Despacho de la cola `notifications`: toma lo que ya tiene que salir y lo manda por WhatsApp.
// Lo dispara el cron cada pocos minutos (/internal/reminders/run) y, para que la confirmación
// llegue al toque, también la API después de reservar o cancelar (notifier.kick()).
import { buildMessage } from './templates.js';

export const MAX_ATTEMPTS = 3;
const BACKOFF_MIN = 5;      // reintento: 5, 10 min…
const STUCK_MIN = 10;       // un 'sending' más viejo que esto se considera colgado
const CONFIRMATION_TTL_H = 6; // una confirmación que no pudo salir en 6 h ya no sirve

const ROW_SELECT = `
  select n.id, n.kind, n.attempts, a.status as appt_status, a.starts_at, a.cancel_token,
         c.name as customer_name, c.phone, b.name as barber_name, n.created_at,
         s.name as shop_name, s.timezone
    from notifications n
    join appointments a on a.id = n.appointment_id
    join customers c on c.id = a.customer_id
    join barbers b on b.id = a.barber_id
    cross join shop_settings s
   where n.id = $1 and s.id = 1`;

/** Por qué este mensaje ya no debe salir (o null si sí). */
function skipReason(r, now) {
  if (!r.phone) return 'sin celular';
  if (r.kind === 'reminder' && r.appt_status !== 'booked') return 'el turno ya no está vigente';
  if (r.kind === 'reminder' && r.starts_at <= now) return 'el turno ya empezó';
  if (r.kind === 'confirmation' && r.appt_status !== 'booked') return 'el turno ya no está vigente';
  if (r.kind === 'confirmation' && now - r.created_at > CONFIRMATION_TTL_H * 3600_000) return 'confirmación vencida';
  return null;
}

/**
 * @param {{query: Function, tx: Function}} db
 * @param {(msg: {to: string, template: string, params: string[]}) => Promise<{id: string|null}>} send
 * @param {Date} now
 * @param {{ webUrl: string, limit?: number }} opts
 */
export async function processDue(db, send, now, { webUrl, limit = 25 }) {
  const result = { sent: 0, retried: 0, failed: 0, skipped: 0 };

  // 1) Reclamar lo pendiente en una transacción (skip locked: dos crons a la vez no mandan doble)
  const ids = await db.tx(async (q) => {
    // Colgados que ya agotaron intentos: se dan por fallidos
    await q.query(`
      update notifications set status = 'failed', error = coalesce(error, 'se colgó el envío')
       where status = 'sending' and attempts >= $2
         and updated_at < $1::timestamptz - make_interval(mins => ${STUCK_MIN})`, [now, MAX_ATTEMPTS]);
    const { rows } = await q.query(`
      select id from notifications
       where (status = 'scheduled' and scheduled_for <= $1)
          or (status = 'sending' and updated_at < $1::timestamptz - make_interval(mins => ${STUCK_MIN}))
       order by scheduled_for
       limit $2
       for update skip locked`, [now, limit]);
    const claimed = rows.map((r) => r.id);
    if (claimed.length) {
      await q.query(`update notifications set status = 'sending', attempts = attempts + 1
                      where id = any($1::uuid[])`, [claimed]);
    }
    return claimed;
  });

  // 2) Mandar uno por uno
  for (const id of ids) {
    const { rows: [r] } = await db.query(ROW_SELECT, [id]);
    if (!r) continue;

    const reason = skipReason(r, now);
    if (reason) {
      await db.query(`update notifications set status = 'skipped', error = $2 where id = $1`, [id, reason]);
      result.skipped += 1;
      continue;
    }

    const msg = buildMessage(r.kind, r, { webUrl, now });
    let providerId;
    try {
      ({ id: providerId } = await send({ to: r.phone, template: msg.template, params: msg.params }));
    } catch (err) {
      if (err.retryable && r.attempts < MAX_ATTEMPTS) {
        await db.query(`update notifications set status = 'scheduled', error = $2,
                          scheduled_for = $3::timestamptz + make_interval(mins => $4) where id = $1`,
        [id, err.message.slice(0, 500), now, BACKOFF_MIN * r.attempts]);
        result.retried += 1;
      } else {
        await db.query(`update notifications set status = 'failed', error = $2 where id = $1`, [id, err.message.slice(0, 500)]);
        result.failed += 1;
      }
      continue;
    }
    // Ya salió. Si este update fallara, queda en 'sending' y se retoma a los 10 min (como mucho
    // MAX_ATTEMPTS veces): preferimos un mensaje repetido a un cliente sin aviso.
    await db.query(`update notifications set status = 'sent', provider_message_id = $2, sent_at = $3, error = null
                     where id = $1`, [id, providerId, now]);
    result.sent += 1;
  }
  return result;
}

/**
 * Corre processDue en segundo plano sin pisarse. kick() se puede llamar muchas veces seguidas.
 */
export function createNotifier({ db, send, webUrl, now = () => new Date(), log = console }) {
  let running = null;
  let again = false;

  const run = async () => {
    do {
      again = false;
      try {
        await processDue(db, send, now(), { webUrl });
      } catch (err) {
        log.error('Error despachando WhatsApp:', err);
      }
    } while (again);
    running = null;
  };

  return {
    kick() {
      if (running) { again = true; return running; }
      running = run();
      return running;
    },
    runOnce: () => processDue(db, send, now(), { webUrl }),
  };
}
