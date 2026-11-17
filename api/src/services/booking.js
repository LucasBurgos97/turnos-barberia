// Lógica de reservas: disponibilidad, crear, ver y cancelar turnos.
import { computeSlots, pickBarber } from '../lib/availability.js';
import { normalizePhone, maskPhone } from '../lib/phone.js';
import { addDays, localDate, localTime, timeToMinutes, weekday, zonedToUtc } from '../lib/time.js';
import { ApiError, badRequest, conflict, notFound } from '../errors.js';

const MAX_BOOKINGS_PER_PHONE_PER_HOUR = 5;

export async function getSettings(q) {
  const { rows } = await q.query('select * from shop_settings where id = 1');
  if (!rows[0]) throw new ApiError(503, 'SHOP_NOT_CONFIGURED', 'El local todavía no está configurado.');
  return rows[0];
}

export async function getShop(db) {
  const settings = await getSettings(db);
  const [{ rows: services }, { rows: barbers }] = await Promise.all([
    db.query(`
      select s.id, s.name, s.duration_min, s.price_ars,
             coalesce(array_agg(bs.barber_id order by b.sort_order) filter (where b.id is not null), '{}') as barber_ids
        from services s
        left join barber_services bs on bs.service_id = s.id
        left join barbers b on b.id = bs.barber_id and b.active
       where s.active
       group by s.id
       order by s.sort_order, s.name`),
    db.query('select id, name, photo_url from barbers where active order by sort_order, name'),
  ]);

  return {
    shop: {
      name: settings.name,
      logoUrl: settings.logo_url,
      address: settings.address,
      mapsUrl: settings.maps_url,
      whatsappPhone: settings.whatsapp_phone,
      timezone: settings.timezone,
      bookingWindowDays: settings.booking_window_days,
      cancelLimitHours: settings.cancel_limit_hours,
    },
    services: services.map((s) => ({
      id: s.id, name: s.name, durationMin: s.duration_min, priceArs: s.price_ars, barberIds: s.barber_ids,
    })),
    barbers: barbers.map((b) => ({ id: b.id, name: b.name, photoUrl: b.photo_url })),
  };
}

/**
 * Carga todo lo necesario para calcular un día y devuelve los horarios libres.
 * ignoreNotice: el dueño puede cargar turnos para "ahora mismo" (o un rato antes, si llegó sin turno).
 */
export async function computeDay(q, { serviceId, barberId, date, now, ignoreNotice = false }) {
  const settings = await getSettings(q);
  const tz = settings.timezone;

  const { rows: [service] } = await q.query(
    'select id, name, duration_min, price_ars from services where id = $1 and active', [serviceId]);
  if (!service) throw notFound('SERVICE_NOT_FOUND', 'Ese servicio no existe o no está disponible.');

  const { rows: barberRows } = await q.query(`
    select b.id from barbers b
      join barber_services bs on bs.barber_id = b.id and bs.service_id = $1
     where b.active and ($2::uuid is null or b.id = $2)
     order by b.sort_order, b.name`, [serviceId, barberId ?? null]);
  if (barberId && barberRows.length === 0) {
    throw notFound('BARBER_NOT_FOUND', 'Ese barbero no hace este servicio o no está disponible.');
  }

  const today = localDate(now, tz);
  const base = { date, service, settings, booked: [] };
  // El dueño puede cargar turnos más allá de la ventana pública (hasta 90 días)
  const windowDays = ignoreNotice ? 90 : settings.booking_window_days;
  if (date < today || date > addDays(today, windowDays)) {
    return { ...base, reason: 'out_of_window', slots: [] };
  }

  const ids = barberRows.map((b) => b.id);
  const dayStart = zonedToUtc(date, 0, tz);
  const dayEnd = zonedToUtc(addDays(date, 1), 0, tz);

  const [{ rows: hours }, { rows: offs }, { rows: appts }] = await Promise.all([
    q.query(`select barber_id, start_time, end_time from working_hours
              where barber_id = any($1::uuid[]) and weekday = $2 order by start_time`, [ids, weekday(date)]),
    q.query(`select barber_id, starts_at, ends_at from time_off
              where (barber_id is null or barber_id = any($1::uuid[]))
                and starts_at < $3 and ends_at > $2`, [ids, dayStart, dayEnd]),
    q.query(`select barber_id, starts_at, ends_at from appointments
              where barber_id = any($1::uuid[]) and status = 'booked'
                and starts_at < $3 and ends_at > $2`, [ids, dayStart, dayEnd]),
  ]);

  const barbers = ids.map((id) => ({
    id,
    ranges: hours.filter((h) => h.barber_id === id)
      .map((h) => ({ start: timeToMinutes(h.start_time), end: timeToMinutes(h.end_time) })),
  }));
  const blocks = offs.map((o) => ({ barberId: o.barber_id, start: o.starts_at, end: o.ends_at }));
  const booked = appts.map((a) => ({ barberId: a.barber_id, start: a.starts_at, end: a.ends_at }));
  const common = { date, tz, durationMin: service.duration_min, stepMin: settings.slot_step_min, barbers, blocks };

  // ¿Abre ese día? (ignorando turnos tomados y el aviso mínimo)
  const openSlots = computeSlots({ ...common, earliest: null, booked: [] });
  if (openSlots.length === 0) return { ...base, booked, reason: 'closed', slots: [] };

  const earliest = ignoreNotice ? null : new Date(now.getTime() + settings.min_notice_min * 60000);
  const slots = computeSlots({ ...common, earliest, booked });
  return { ...base, booked, reason: slots.length ? null : 'full', slots };
}

export async function getAvailability(db, { serviceId, barberId, date }, now, { ignoreNotice = false } = {}) {
  const day = await computeDay(db, { serviceId, barberId, date, now, ignoreNotice });
  return {
    date,
    reason: day.reason, // null | 'closed' | 'full' | 'out_of_window'
    slots: day.slots.map((s) => ({ time: s.time, startsAt: s.startsAt.toISOString(), barberIds: s.barberIds })),
  };
}

export async function createAppointment(db, input, now, { defaultArea } = {}) {
  const phone = normalizePhone(input.phone, { defaultArea });
  if (!phone) throw badRequest('INVALID_PHONE', 'Revisá el celular: escribilo con característica, ej. 387 412 3456.');

  const startsAt = new Date(input.startsAt);
  const settings = await getSettings(db);
  const date = localDate(startsAt, settings.timezone);
  const day = await computeDay(db, { serviceId: input.serviceId, barberId: input.barberId, date, now });

  if (day.reason === 'out_of_window') {
    throw badRequest('OUT_OF_WINDOW', 'Esa fecha no está habilitada para reservar.');
  }
  const slot = day.slots.find((s) => s.startsAt.getTime() === startsAt.getTime());
  if (!slot) throw conflict('SLOT_UNAVAILABLE', 'Ese horario ya no está disponible. Elegí otro.');

  const barberId = input.barberId ?? pickBarber(slot.barberIds, day.booked);

  const { rows: [recent] } = await db.query(`
    select count(*)::int as n from appointments a join customers c on c.id = a.customer_id
     where c.phone = $1 and a.created_at > $2`, [phone, new Date(now.getTime() - 3600_000)]);
  if (recent.n >= MAX_BOOKINGS_PER_PHONE_PER_HOUR) {
    throw new ApiError(429, 'TOO_MANY_BOOKINGS', 'Hiciste muchas reservas seguidas. Probá más tarde o escribinos.');
  }

  let token;
  try {
    token = await db.tx(async (q) => {
      const { rows: [customer] } = await q.query(`
        insert into customers (name, phone) values ($1, $2)
        on conflict (phone) do update set name = excluded.name
        returning id`, [input.name, phone]);
      const { rows: [appt] } = await q.query(`
        insert into appointments
          (barber_id, service_id, customer_id, starts_at, ends_at, service_name_snapshot, price_snapshot, source)
        values ($1, $2, $3, $4, $5, $6, $7, 'online')
        returning cancel_token`,
      [barberId, day.service.id, customer.id, slot.startsAt, slot.endsAt, day.service.name, day.service.price_ars]);
      return appt.cancel_token;
    });
  } catch (err) {
    if (err?.code === '23P01') throw conflict('SLOT_TAKEN', 'Ese horario se acaba de ocupar. Elegí otro.');
    throw err;
  }

  // Aviso (no bloquea): ya tenía otro turno ese mismo día
  const { rows: [same] } = await db.query(`
    select count(*)::int as n from appointments a join customers c on c.id = a.customer_id
     where c.phone = $1 and a.status = 'booked' and a.cancel_token <> $2
       and a.starts_at >= $3 and a.starts_at < $4`,
  [phone, token, zonedToUtc(date, 0, settings.timezone), zonedToUtc(addDays(date, 1), 0, settings.timezone)]);

  const appointment = await getByToken(db, token, now);
  return { token, appointment, warnings: same.n > 0 ? ['SAME_DAY_BOOKING'] : [] };
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

async function findByToken(q, token) {
  if (!TOKEN_RE.test(token)) return null;
  const { rows: [row] } = await q.query(`
    select a.id, a.number, a.status, a.starts_at, a.ends_at, a.service_name_snapshot, a.price_snapshot,
           b.name as barber_name, c.name as customer_name, c.phone as customer_phone
      from appointments a
      join barbers b on b.id = a.barber_id
      join customers c on c.id = a.customer_id
     where a.cancel_token = $1`, [token]);
  return row ?? null;
}

function cancelState(row, settings, now) {
  const deadline = new Date(row.starts_at.getTime() - settings.cancel_limit_hours * 3600_000);
  let reason = null;
  if (row.status !== 'booked') reason = row.status.startsWith('cancelled') ? 'ALREADY_CANCELLED' : 'NOT_ACTIVE';
  else if (now >= row.starts_at) reason = 'PAST';
  else if (now > deadline) reason = 'TOO_LATE';
  return { allowed: reason === null, reason, deadline };
}

export async function getByToken(db, token, now) {
  const row = await findByToken(db, token);
  if (!row) throw notFound('APPOINTMENT_NOT_FOUND', 'No encontramos ese turno. Revisá el link.');
  const settings = await getSettings(db);
  const tz = settings.timezone;
  const cancel = cancelState(row, settings, now);

  return {
    number: row.number,
    status: row.status,
    date: localDate(row.starts_at, tz),
    time: localTime(row.starts_at, tz),
    endTime: localTime(row.ends_at, tz),
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    service: { name: row.service_name_snapshot, priceArs: row.price_snapshot },
    barber: { name: row.barber_name },
    customer: { firstName: row.customer_name.trim().split(/\s+/)[0], phone: maskPhone(row.customer_phone) },
    shop: { name: settings.name, address: settings.address, mapsUrl: settings.maps_url, whatsappPhone: settings.whatsapp_phone },
    cancel: { allowed: cancel.allowed, reason: cancel.reason, deadline: cancel.deadline.toISOString() },
  };
}

const CANCEL_MESSAGES = {
  ALREADY_CANCELLED: 'Este turno ya estaba cancelado.',
  NOT_ACTIVE: 'Este turno ya no está vigente.',
  PAST: 'Este turno ya pasó.',
  TOO_LATE: 'Ya no se puede cancelar online. Escribinos por WhatsApp.',
};

export async function cancelByToken(db, token, now) {
  const row = await findByToken(db, token);
  if (!row) throw notFound('APPOINTMENT_NOT_FOUND', 'No encontramos ese turno. Revisá el link.');
  const settings = await getSettings(db);
  const state = cancelState(row, settings, now);
  if (!state.allowed) throw conflict(state.reason, CANCEL_MESSAGES[state.reason]);

  const { rows } = await db.query(`
    update appointments set status = 'cancelled_by_customer', cancelled_at = $2
     where id = $1 and status = 'booked' returning id`, [row.id, now]);
  if (rows.length === 0) throw conflict('ALREADY_CANCELLED', CANCEL_MESSAGES.ALREADY_CANCELLED);

  return getByToken(db, token, now);
}
