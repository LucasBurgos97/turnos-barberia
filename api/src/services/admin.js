// Panel del dueño: agenda del día, detalle de turno, cambios de estado y turnos manuales.
import { computeDay, getSettings } from './booking.js';
import { normalizePhone } from '../lib/phone.js';
import { addDays, localDate, localTime, timeToMinutes, weekday, zonedToUtc } from '../lib/time.js';
import { badRequest, conflict, notFound } from '../errors.js';

const toHHMM = (t) => String(t).slice(0, 5);

function appointmentView(r, tz) {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    source: r.source,
    barberId: r.barber_id,
    barberName: r.barber_name,
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
    date: localDate(r.starts_at, tz),
    time: localTime(r.starts_at, tz),
    endTime: localTime(r.ends_at, tz),
    service: { id: r.service_id, name: r.service_name_snapshot, priceArs: r.price_snapshot },
    customer: { id: r.customer_id, name: r.customer_name, phone: r.customer_phone, noShowCount: r.no_show_count },
    notifications: r.notifications ?? {},
    createdAt: r.created_at.toISOString(),
    cancelledAt: r.cancelled_at?.toISOString() ?? null,
  };
}

const APPT_SELECT = `
  select a.*, b.name as barber_name, c.name as customer_name, c.phone as customer_phone, c.no_show_count,
         (select json_object_agg(n.kind, n.status) from notifications n where n.appointment_id = a.id) as notifications
    from appointments a
    join barbers b on b.id = a.barber_id
    join customers c on c.id = a.customer_id`;

/** A2 — Agenda de un día: barberos con su horario y todos los turnos (incluidos cancelados). */
export async function getAgenda(db, date, now) {
  const settings = await getSettings(db);
  const tz = settings.timezone;
  const dayStart = zonedToUtc(date, 0, tz);
  const dayEnd = zonedToUtc(addDays(date, 1), 0, tz);

  const [{ rows: barbers }, { rows: hours }, { rows: offs }, { rows: appts }] = await Promise.all([
    db.query('select id, name, photo_url from barbers where active order by sort_order, name'),
    db.query('select barber_id, start_time, end_time from working_hours where weekday = $1 order by start_time', [weekday(date)]),
    db.query(`select barber_id, starts_at, ends_at, reason from time_off
               where starts_at < $2 and ends_at > $1`, [dayStart, dayEnd]),
    db.query(`${APPT_SELECT} where a.starts_at >= $1 and a.starts_at < $2 order by a.starts_at, b.sort_order`, [dayStart, dayEnd]),
  ]);

  const list = appts.map((r) => appointmentView(r, tz));
  const active = list.filter((a) => a.status !== 'cancelled_by_customer' && a.status !== 'cancelled_by_shop');
  const nowIso = now.toISOString();

  return {
    date,
    today: localDate(now, tz),
    now: nowIso,
    barbers: barbers.map((b) => {
      const ranges = hours.filter((h) => h.barber_id === b.id).map((h) => ({ start: toHHMM(h.start_time), end: toHHMM(h.end_time) }));
      const off = offs.filter((o) => o.barber_id === null || o.barber_id === b.id);
      // Cerrado si no trabaja ese día o un bloqueo cubre todo su horario
      const closed = ranges.length === 0 || ranges.every((r) => off.some((o) =>
        o.starts_at <= zonedToUtc(date, timeToMinutes(r.start), tz) && o.ends_at >= zonedToUtc(date, timeToMinutes(r.end), tz)));
      return {
        id: b.id,
        name: b.name,
        photoUrl: b.photo_url,
        ranges,
        closed,
        timeOff: off.map((o) => ({
          from: localTime(o.starts_at, tz), to: localTime(o.ends_at, tz), reason: o.reason, wholeShop: o.barber_id === null,
        })),
      };
    }),
    appointments: list,
    summary: {
      total: active.length,
      done: active.filter((a) => a.status === 'completed').length,
      noShow: active.filter((a) => a.status === 'no_show').length,
      cancelled: list.length - active.length,
      next: active.find((a) => a.status === 'booked' && a.startsAt > nowIso) ?? null,
    },
  };
}

/** A3 — Detalle de un turno: cliente con historial y mensajes de WhatsApp. */
export async function getAdminAppointment(db, id) {
  const settings = await getSettings(db);
  const { rows: [r] } = await db.query(`${APPT_SELECT} where a.id = $1`, [id]);
  if (!r) throw notFound('APPOINTMENT_NOT_FOUND', 'Ese turno no existe.');

  const [{ rows: [hist] }, { rows: notifs }] = await Promise.all([
    db.query(`select count(*)::int as total,
                     count(*) filter (where status = 'completed')::int as completed,
                     count(*) filter (where status = 'no_show')::int as no_show,
                     count(*) filter (where status in ('cancelled_by_customer', 'cancelled_by_shop'))::int as cancelled,
                     max(starts_at) filter (where status = 'completed') as last_visit
                from appointments where customer_id = $1 and id <> $2`, [r.customer_id, id]),
    db.query(`select id, kind, status, scheduled_for, sent_at, error from notifications
               where appointment_id = $1 order by created_at`, [id]),
  ]);

  return {
    ...appointmentView(r, settings.timezone),
    customer: {
      id: r.customer_id,
      name: r.customer_name,
      phone: r.customer_phone,
      noShowCount: r.no_show_count,
      notes: null,
      history: {
        total: hist.total,
        completed: hist.completed,
        noShow: hist.no_show,
        cancelled: hist.cancelled,
        lastVisit: hist.last_visit ? localDate(hist.last_visit, settings.timezone) : null,
      },
    },
    notifications: notifs.map((n) => ({
      id: n.id, kind: n.kind, status: n.status, scheduledFor: n.scheduled_for.toISOString(),
      sentAt: n.sent_at?.toISOString() ?? null, error: n.error,
    })),
  };
}

const NOTIF_FILTERS = {
  all: null,
  pending: ['scheduled', 'sending'],
  sent: ['sent', 'delivered', 'read'],
  failed: ['failed'],
};

/** A7 — Log de mensajes de WhatsApp, lo más reciente primero. */
export async function listNotifications(db, { filter = 'all', limit = 100 }) {
  const settings = await getSettings(db);
  const tz = settings.timezone;
  const statuses = NOTIF_FILTERS[filter] ?? null;
  const [{ rows }, { rows: [counts] }] = await Promise.all([
    db.query(`
      select n.id, n.kind, n.status, n.scheduled_for, n.sent_at, n.error, n.attempts, n.updated_at,
             a.id as appointment_id, a.number, a.starts_at, a.status as appt_status,
             c.name as customer_name, c.phone
        from notifications n
        join appointments a on a.id = n.appointment_id
        join customers c on c.id = a.customer_id
       where ($1::text is null or n.status::text = any(string_to_array($1::text, ',')))
       order by case when n.status in ('scheduled', 'sending') then 0 else 1 end,
                case when n.status in ('scheduled', 'sending') then n.scheduled_for end asc,
                coalesce(n.sent_at, n.updated_at) desc
       limit $2`, [statuses ? statuses.join(',') : null, limit]),
    db.query(`select count(*) filter (where status = 'failed')::int as failed,
                     count(*) filter (where status in ('scheduled', 'sending'))::int as pending
                from notifications`),
  ]);

  return {
    counts,
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      scheduledFor: r.scheduled_for.toISOString(),
      sentAt: r.sent_at?.toISOString() ?? null,
      updatedAt: r.updated_at.toISOString(),
      error: r.error,
      attempts: r.attempts,
      appointment: {
        id: r.appointment_id, number: r.number, status: r.appt_status,
        date: localDate(r.starts_at, tz), time: localTime(r.starts_at, tz),
      },
      customer: { name: r.customer_name, phone: r.phone },
    })),
  };
}

/** Reintentar un mensaje que falló: vuelve a la cola para ya. */
export async function retryNotification(db, id, now) {
  const { rows } = await db.query(`
    update notifications set status = 'scheduled', scheduled_for = $2, attempts = 0, error = null
     where id = $1 and status = 'failed' returning id`, [id, now]);
  if (rows.length === 0) {
    const { rows: [exists] } = await db.query('select status from notifications where id = $1', [id]);
    if (!exists) throw notFound('NOTIFICATION_NOT_FOUND', 'Ese mensaje no existe.');
    throw conflict('NOT_FAILED', 'Solo se pueden reintentar los mensajes que fallaron.');
  }
  return { ok: true };
}

// Transiciones que puede hacer el dueño
const ALLOWED = {
  booked: ['completed', 'no_show', 'cancelled_by_shop'],
  completed: ['booked', 'no_show'],
  no_show: ['booked', 'completed'],
  cancelled_by_customer: [],
  cancelled_by_shop: [],
};

export async function updateAppointmentStatus(db, id, status, now) {
  const { rows: [cur] } = await db.query('select status from appointments where id = $1', [id]);
  if (!cur) throw notFound('APPOINTMENT_NOT_FOUND', 'Ese turno no existe.');
  if (cur.status === status) return getAdminAppointment(db, id);
  if (!ALLOWED[cur.status].includes(status)) {
    throw conflict('INVALID_TRANSITION', 'Ese cambio no se puede hacer sobre un turno cancelado.');
  }

  try {
    await db.query(
      `update appointments
          set status = $2::appointment_status,
              cancelled_at = case when $2::appointment_status = 'cancelled_by_shop' then $3::timestamptz else null end
        where id = $1 and status = $4::appointment_status`,
      [id, status, now, cur.status],
    );
  } catch (err) {
    if (err?.code === '23P01') throw conflict('SLOT_TAKEN', 'Ese horario ya lo ocupa otro turno.');
    throw err;
  }
  return getAdminAppointment(db, id);
}

/** A4 — Turno manual (llamó por teléfono o llegó sin turno). Celular opcional, sin aviso mínimo. */
export async function createManualAppointment(db, input, now, { defaultArea } = {}) {
  let phone = null;
  if (input.phone && input.phone.trim()) {
    phone = normalizePhone(input.phone, { defaultArea });
    if (!phone) throw badRequest('INVALID_PHONE', 'Revisá el celular: escribilo con característica, ej. 387 412 3456.');
  }

  const startsAt = new Date(input.startsAt);
  const settings = await getSettings(db);
  const date = localDate(startsAt, settings.timezone);
  const day = await computeDay(db, { serviceId: input.serviceId, barberId: input.barberId, date, now, ignoreNotice: true });
  if (day.reason === 'out_of_window') throw badRequest('OUT_OF_WINDOW', 'Esa fecha no se puede cargar.');
  const slot = day.slots.find((s) => s.startsAt.getTime() === startsAt.getTime());
  if (!slot) throw conflict('SLOT_UNAVAILABLE', 'Ese horario no está libre para ese barbero.');

  let id;
  try {
    id = await db.tx(async (q) => {
      const { rows: [customer] } = phone
        ? await q.query(`insert into customers (name, phone) values ($1, $2)
                         on conflict (phone) do update set name = excluded.name returning id`, [input.name, phone])
        : await q.query('insert into customers (name) values ($1) returning id', [input.name]);
      const { rows: [appt] } = await q.query(`
        insert into appointments
          (barber_id, service_id, customer_id, starts_at, ends_at, service_name_snapshot, price_snapshot, source)
        values ($1, $2, $3, $4, $5, $6, $7, 'manual') returning id`,
      [input.barberId, day.service.id, customer.id, slot.startsAt, slot.endsAt, day.service.name, day.service.price_ars]);
      return appt.id;
    });
  } catch (err) {
    if (err?.code === '23P01') throw conflict('SLOT_TAKEN', 'Ese horario se acaba de ocupar.');
    throw err;
  }
  return getAdminAppointment(db, id);
}
