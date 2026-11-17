// Configuración del local desde el panel: servicios, barberos, horarios, bloqueos y ajustes.
import { getSettings } from './booking.js';
import { normalizePhone } from '../lib/phone.js';
import { addDays, localDate, localTime, timeToMinutes, zonedToUtc } from '../lib/time.js';
import { badRequest, notFound } from '../errors.js';

const hhmm = (t) => String(t).slice(0, 5);

// ---------------------------------------------------------------- Servicios (A5)

export async function listServices(db) {
  const { rows } = await db.query(`
    select s.*, coalesce(array_agg(bs.barber_id) filter (where bs.barber_id is not null), '{}') as barber_ids,
           (select count(*)::int from appointments a where a.service_id = s.id and a.status = 'booked' and a.starts_at > now()) as upcoming
      from services s left join barber_services bs on bs.service_id = s.id
     group by s.id order by s.sort_order, s.name`);
  return rows.map((s) => ({
    id: s.id, name: s.name, durationMin: s.duration_min, priceArs: s.price_ars, active: s.active,
    sortOrder: s.sort_order, barberIds: s.barber_ids, upcoming: s.upcoming,
  }));
}

async function setServiceBarbers(q, serviceId, barberIds) {
  await q.query('delete from barber_services where service_id = $1', [serviceId]);
  for (const b of barberIds) {
    await q.query('insert into barber_services (barber_id, service_id) values ($1, $2) on conflict do nothing', [b, serviceId]);
  }
}

export async function saveService(db, id, input) {
  const sid = await db.tx(async (q) => {
    let serviceId = id;
    if (!id) {
      const { rows: [{ next }] } = await q.query('select coalesce(max(sort_order), 0) + 1 as next from services');
      const { rows: [s] } = await q.query(`
        insert into services (name, duration_min, price_ars, active, sort_order)
        values ($1, $2, $3, $4, $5) returning id`,
      [input.name, input.durationMin, input.priceArs, input.active ?? true, input.sortOrder ?? next]);
      serviceId = s.id;
    } else {
      const { rows } = await q.query(`
        update services set
          name = coalesce($2, name), duration_min = coalesce($3, duration_min), price_ars = coalesce($4, price_ars),
          active = coalesce($5, active), sort_order = coalesce($6, sort_order)
         where id = $1 returning id`,
      [id, input.name ?? null, input.durationMin ?? null, input.priceArs ?? null, input.active ?? null, input.sortOrder ?? null]);
      if (!rows.length) throw notFound('SERVICE_NOT_FOUND', 'Ese servicio no existe.');
    }
    if (input.barberIds) await setServiceBarbers(q, serviceId, input.barberIds);
    return serviceId;
  });
  return (await listServices(db)).find((s) => s.id === sid);
}

/** Reordenar: recibe la lista de ids en el orden nuevo. */
export async function reorder(db, table, ids) {
  await db.tx(async (q) => {
    for (const [i, id] of ids.entries()) await q.query(`update ${table} set sort_order = $2 where id = $1`, [id, i + 1]);
  });
}

// ---------------------------------------------------------------- Barberos y horarios (A6)

export async function listBarbers(db) {
  const [{ rows: barbers }, { rows: links }, { rows: hours }] = await Promise.all([
    db.query(`select b.*, (select count(*)::int from appointments a
                            where a.barber_id = b.id and a.status = 'booked' and a.starts_at > now()) as upcoming
                from barbers b order by b.sort_order, b.name`),
    db.query('select barber_id, service_id from barber_services'),
    db.query('select barber_id, weekday, start_time, end_time from working_hours order by weekday, start_time'),
  ]);
  return barbers.map((b) => ({
    id: b.id, name: b.name, photoUrl: b.photo_url, active: b.active, sortOrder: b.sort_order, upcoming: b.upcoming,
    serviceIds: links.filter((l) => l.barber_id === b.id).map((l) => l.service_id),
    hours: hours.filter((h) => h.barber_id === b.id)
      .map((h) => ({ weekday: h.weekday, start: hhmm(h.start_time), end: hhmm(h.end_time) })),
  }));
}

function validateHours(hours) {
  const byDay = new Map();
  for (const h of hours) {
    if (timeToMinutes(h.end) <= timeToMinutes(h.start)) {
      throw badRequest('INVALID_HOURS', `El tramo ${h.start}–${h.end} termina antes de empezar.`);
    }
    const list = byDay.get(h.weekday) ?? [];
    for (const o of list) {
      if (timeToMinutes(h.start) < timeToMinutes(o.end) && timeToMinutes(o.start) < timeToMinutes(h.end)) {
        throw badRequest('INVALID_HOURS', `Los tramos ${o.start}–${o.end} y ${h.start}–${h.end} se pisan.`);
      }
    }
    list.push(h);
    byDay.set(h.weekday, list);
  }
}

export async function saveBarber(db, id, input) {
  if (input.hours) validateHours(input.hours);
  const bid = await db.tx(async (q) => {
    let barberId = id;
    if (!id) {
      const { rows: [{ next }] } = await q.query('select coalesce(max(sort_order), 0) + 1 as next from barbers');
      const { rows: [b] } = await q.query(`
        insert into barbers (name, photo_url, active, sort_order) values ($1, $2, $3, $4) returning id`,
      [input.name, input.photoUrl ?? null, input.active ?? true, input.sortOrder ?? next]);
      barberId = b.id;
    } else {
      const { rows } = await q.query(`
        update barbers set name = coalesce($2, name),
                           photo_url = case when $3::boolean then $4 else photo_url end,
                           active = coalesce($5, active), sort_order = coalesce($6, sort_order)
         where id = $1 returning id`,
      [id, input.name ?? null, input.photoUrl !== undefined, input.photoUrl ?? null, input.active ?? null, input.sortOrder ?? null]);
      if (!rows.length) throw notFound('BARBER_NOT_FOUND', 'Ese barbero no existe.');
    }
    if (input.serviceIds) {
      await q.query('delete from barber_services where barber_id = $1', [barberId]);
      for (const s of input.serviceIds) {
        await q.query('insert into barber_services (barber_id, service_id) values ($1, $2) on conflict do nothing', [barberId, s]);
      }
    }
    if (input.hours) {
      await q.query('delete from working_hours where barber_id = $1', [barberId]);
      for (const h of input.hours) {
        await q.query('insert into working_hours (barber_id, weekday, start_time, end_time) values ($1, $2, $3, $4)',
          [barberId, h.weekday, h.start, h.end]);
      }
    }
    return barberId;
  });
  return (await listBarbers(db)).find((b) => b.id === bid);
}

// ---------------------------------------------------------------- Bloqueos: vacaciones, feriados (A6)

export async function listTimeOff(db, now) {
  const settings = await getSettings(db);
  const tz = settings.timezone;
  const { rows } = await db.query(`
    select t.*, b.name as barber_name from time_off t left join barbers b on b.id = t.barber_id
     where t.ends_at > $1 order by t.starts_at`, [now]);
  return rows.map((t) => {
    const endInclusive = new Date(t.ends_at.getTime() - 1);
    const fromTime = localTime(t.starts_at, tz);
    const toTime = localTime(t.ends_at, tz);
    return {
      id: t.id,
      barberId: t.barber_id,
      barberName: t.barber_name,
      fromDate: localDate(t.starts_at, tz),
      toDate: localDate(endInclusive, tz),
      allDay: fromTime === '00:00' && toTime === '00:00',
      fromTime,
      toTime,
      reason: t.reason,
    };
  });
}

/**
 * input: { barberId|null, fromDate, toDate, fromTime?, toTime?, reason? } — fechas y horas locales.
 * Sin horas = días completos. Devuelve el bloqueo y los turnos vigentes que quedan adentro (para avisar).
 */
export async function createTimeOff(db, input) {
  const settings = await getSettings(db);
  const tz = settings.timezone;
  if (input.toDate < input.fromDate) throw badRequest('INVALID_RANGE', 'La fecha "hasta" es anterior a "desde".');
  const partial = Boolean(input.fromTime && input.toTime);
  const startsAt = zonedToUtc(input.fromDate, partial ? timeToMinutes(input.fromTime) : 0, tz);
  const endsAt = partial
    ? zonedToUtc(input.toDate, timeToMinutes(input.toTime), tz)
    : zonedToUtc(addDays(input.toDate, 1), 0, tz);
  if (endsAt <= startsAt) throw badRequest('INVALID_RANGE', 'El horario "hasta" tiene que ser después de "desde".');

  const { rows: [t] } = await db.query(`
    insert into time_off (barber_id, starts_at, ends_at, reason) values ($1, $2, $3, $4) returning id`,
  [input.barberId ?? null, startsAt, endsAt, input.reason?.trim() || null]);

  const { rows: affected } = await db.query(`
    select a.id, a.starts_at, c.name as customer_name, b.name as barber_name
      from appointments a join customers c on c.id = a.customer_id join barbers b on b.id = a.barber_id
     where a.status = 'booked' and a.starts_at < $2 and a.ends_at > $1 and ($3::uuid is null or a.barber_id = $3)
       and a.starts_at > now()
     order by a.starts_at`, [startsAt, endsAt, input.barberId ?? null]);

  return {
    id: t.id,
    affected: affected.map((a) => ({
      id: a.id, date: localDate(a.starts_at, tz), time: localTime(a.starts_at, tz),
      customerName: a.customer_name, barberName: a.barber_name,
    })),
  };
}

export async function deleteTimeOff(db, id) {
  const { rows } = await db.query('delete from time_off where id = $1 returning id', [id]);
  if (!rows.length) throw notFound('TIME_OFF_NOT_FOUND', 'Ese bloqueo no existe.');
  return { ok: true };
}

// ---------------------------------------------------------------- Ajustes (A8)

function settingsView(s) {
  return {
    name: s.name, logoUrl: s.logo_url, address: s.address, mapsUrl: s.maps_url, whatsappPhone: s.whatsapp_phone,
    timezone: s.timezone, slotStepMin: s.slot_step_min, bookingWindowDays: s.booking_window_days,
    minNoticeMin: s.min_notice_min, cancelLimitHours: s.cancel_limit_hours, reminderHoursBefore: s.reminder_hours_before,
  };
}

export async function getAdminSettings(db) {
  return settingsView(await getSettings(db));
}

export async function updateSettings(db, input, { defaultArea } = {}) {
  let whatsapp;
  if (input.whatsappPhone !== undefined) {
    whatsapp = input.whatsappPhone ? normalizePhone(input.whatsappPhone, { defaultArea }) : null;
    if (input.whatsappPhone && !whatsapp) throw badRequest('INVALID_PHONE', 'Revisá el WhatsApp del local.');
  }
  const before = await getSettings(db);

  await db.tx(async (q) => {
    await q.query(`
      update shop_settings set
        name = coalesce($1, name),
        logo_url = case when $2::boolean then $3 else logo_url end,
        address = case when $4::boolean then $5 else address end,
        maps_url = case when $6::boolean then $7 else maps_url end,
        whatsapp_phone = case when $8::boolean then $9 else whatsapp_phone end,
        slot_step_min = coalesce($10, slot_step_min),
        booking_window_days = coalesce($11, booking_window_days),
        min_notice_min = coalesce($12, min_notice_min),
        cancel_limit_hours = coalesce($13, cancel_limit_hours),
        reminder_hours_before = coalesce($14, reminder_hours_before)
       where id = 1`,
    [
      input.name ?? null,
      input.logoUrl !== undefined, input.logoUrl || null,
      input.address !== undefined, input.address || null,
      input.mapsUrl !== undefined, input.mapsUrl || null,
      input.whatsappPhone !== undefined, whatsapp ?? null,
      input.slotStepMin ?? null, input.bookingWindowDays ?? null, input.minNoticeMin ?? null,
      input.cancelLimitHours ?? null, input.reminderHoursBefore ?? null,
    ]);

    // Si cambió la anticipación del recordatorio, se reprograman los que todavía no salieron
    if (input.reminderHoursBefore && input.reminderHoursBefore !== before.reminder_hours_before) {
      await q.query(`
        update notifications n
           set scheduled_for = a.starts_at - make_interval(hours => $1)
          from appointments a
         where a.id = n.appointment_id and n.kind = 'reminder' and n.status = 'scheduled'`, [input.reminderHoursBefore]);
    }
  });
  return getAdminSettings(db);
}
