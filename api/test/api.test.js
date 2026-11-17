import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, startApp, SEED } from './helpers.js';
import { addDays, localDate, weekday, zonedToUtc } from '../src/lib/time.js';

const tz = 'America/Argentina/Salta';
let db;
let api;

// Próximo día (a 2+ días de hoy) que caiga en el weekday pedido: siempre dentro de la ventana de 14 días
function next(wd) {
  let d = addDays(localDate(new Date(), tz), 2);
  while (weekday(d) !== wd) d = addDays(d, 1);
  return d;
}
const TUE = next(2);
const WED = next(3);
const MON = next(1);
const iso = (date, hhmm) => zonedToUtc(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), tz).toISOString();

const booking = (over = {}) => ({
  serviceId: SEED.corte, barberId: null, startsAt: iso(TUE, '10:00'),
  name: 'Martín Prueba', phone: '387 15 412-3456', ...over,
});

before(async () => {
  db = await createTestDb();
  api = await startApp({ db });
});
after(async () => {
  await api.close();
  await db.close();
});

test('GET /api/shop devuelve local, servicios y barberos activos', async () => {
  const { status, body } = await api.get('/api/shop');
  assert.equal(status, 200);
  assert.equal(body.shop.name, 'Barbería Ejemplo');
  assert.equal(body.services.length, 4);
  assert.equal(body.barbers.length, 2);
  assert.deepEqual(body.services.find((s) => s.name === 'Barba').barberIds, [SEED.nico]);
});

test('disponibilidad de un martes con horario cortado', async () => {
  const { status, body } = await api.get(`/api/availability?serviceId=${SEED.corte}&date=${TUE}`);
  assert.equal(status, 200);
  assert.equal(body.reason, null);
  assert.equal(body.slots.length, 30);
  assert.equal(body.slots[0].time, '09:00');
  assert.deepEqual(body.slots[0].barberIds, [SEED.nico, SEED.fede]);
});

test('lunes cerrado, fecha fuera de ventana, fecha pasada', async () => {
  const get = (date) => api.get(`/api/availability?serviceId=${SEED.corte}&date=${date}`);
  assert.equal((await get(MON)).body.reason, 'closed');
  assert.equal((await get(addDays(localDate(new Date(), tz), 30))).body.reason, 'out_of_window');
  assert.equal((await get('2020-01-07')).body.reason, 'out_of_window');
});

test('validaciones de la consulta', async () => {
  assert.equal((await api.get('/api/availability?serviceId=nope&date=2026-01-01')).status, 400);
  assert.equal((await api.get(`/api/availability?serviceId=${SEED.corte}&date=2026-02-30`)).status, 400);
  const r = await api.get(`/api/availability?serviceId=${SEED.barba}&barberId=${SEED.fede}&date=${TUE}`);
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'BARBER_NOT_FOUND');
});

let token;

test('reservar con "cualquiera": asigna barbero, normaliza celular y encola WhatsApp', async () => {
  const { status, body } = await api.post('/api/appointments', booking());
  assert.equal(status, 201, JSON.stringify(body));
  token = body.token;
  assert.match(token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(body.appointment.status, 'booked');
  assert.equal(body.appointment.time, '10:00');
  assert.equal(body.appointment.endTime, '10:30');
  assert.equal(body.appointment.barber.name, 'Nico (ejemplo)');
  assert.equal(body.appointment.customer.firstName, 'Martín');
  assert.equal(body.appointment.customer.phone, '···3456');
  assert.equal(body.appointment.cancel.allowed, true);
  assert.ok(body.appointment.number > 0);

  const { rows: [c] } = await db.query("select phone from customers where name = 'Martín Prueba'");
  assert.equal(c.phone, '+5493874123456');
  const { rows: n } = await db.query(`
    select n.kind, n.status from notifications n join appointments a on a.id = n.appointment_id
     where a.cancel_token = $1 order by n.kind`, [token]);
  assert.deepEqual(n.map((x) => `${x.kind}:${x.status}`), ['confirmation:scheduled', 'reminder:scheduled']);
});

test('el horario reservado deja de ofrecerse para ese barbero', async () => {
  const { body } = await api.get(`/api/availability?serviceId=${SEED.corte}&date=${TUE}`);
  assert.deepEqual(body.slots.find((s) => s.time === '10:00').barberIds, [SEED.fede]);
  const { body: nico } = await api.get(`/api/availability?serviceId=${SEED.corte}&barberId=${SEED.nico}&date=${TUE}`);
  assert.ok(!nico.slots.some((s) => s.time === '10:00' || s.time === '09:45' || s.time === '10:15'));
});

test('mismo horario y mismo barbero → 409', async () => {
  const r = await api.post('/api/appointments', booking({ barberId: SEED.nico, phone: '3875550000' }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'SLOT_UNAVAILABLE');
});

test('dos reservas simultáneas al mismo horario: entra una sola', async () => {
  const b = (phone) => booking({ barberId: SEED.fede, startsAt: iso(TUE, '11:00'), phone });
  const results = await Promise.all([
    api.post('/api/appointments', b('3875551111')),
    api.post('/api/appointments', b('3875552222')),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const { rows: [{ n }] } = await db.query(`
    select count(*)::int n from appointments where barber_id = $1 and starts_at = $2 and status = 'booked'`,
  [SEED.fede, iso(TUE, '11:00')]);
  assert.equal(n, 1);
});

test('horario fuera de la grilla, en la siesta o en día cerrado → 409', async () => {
  for (const startsAt of [iso(TUE, '10:07'), iso(TUE, '14:00'), iso(MON, '10:00')]) {
    const r = await api.post('/api/appointments', booking({ startsAt, phone: '3875553333' }));
    assert.equal(r.status, 409, startsAt);
  }
});

test('celular inválido y datos faltantes → 400', async () => {
  const bad = await api.post('/api/appointments', booking({ phone: '123456' }));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'INVALID_PHONE');
  const missing = await api.post('/api/appointments', { serviceId: SEED.corte });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'VALIDATION_ERROR');
});

test('mismo celular, segundo turno el mismo día → se reserva con aviso', async () => {
  const r = await api.post('/api/appointments', booking({ startsAt: iso(TUE, '18:00') }));
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.warnings, ['SAME_DAY_BOOKING']);
  const { rows } = await db.query("select count(*)::int n from customers where phone = '+5493874123456'");
  assert.equal(rows[0].n, 1, 'reutiliza el cliente');
});

test('ver turno por token; token inexistente → 404', async () => {
  const ok = await api.get(`/api/appointments/by-token/${token}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.shop.name, 'Barbería Ejemplo');
  assert.equal((await api.get('/api/appointments/by-token/no-existe-este-token-xxxxx')).status, 404);
  assert.equal((await api.get('/api/appointments/by-token/x')).status, 404);
});

test('cancelar fuera de plazo o turno pasado → 409', async () => {
  const { body } = await api.get(`/api/appointments/by-token/${token}`);
  const starts = new Date(body.startsAt).getTime();

  const late = await startApp({ db, now: () => new Date(starts - 2 * 3600_000) });
  const r1 = await late.post(`/api/appointments/by-token/${token}/cancel`);
  await late.close();
  assert.equal(r1.status, 409);
  assert.equal(r1.body.error.code, 'TOO_LATE');

  const past = await startApp({ db, now: () => new Date(starts + 60_000) });
  const r2 = await past.post(`/api/appointments/by-token/${token}/cancel`);
  await past.close();
  assert.equal(r2.body.error.code, 'PAST');
});

test('cancelar: libera el horario, anula el recordatorio y no se puede cancelar dos veces', async () => {
  const r = await api.post(`/api/appointments/by-token/${token}/cancel`);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'cancelled_by_customer');
  assert.equal(r.body.cancel.reason, 'ALREADY_CANCELLED');

  const again = await api.post(`/api/appointments/by-token/${token}/cancel`);
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'ALREADY_CANCELLED');

  const { body } = await api.get(`/api/availability?serviceId=${SEED.corte}&barberId=${SEED.nico}&date=${TUE}`);
  assert.ok(body.slots.some((s) => s.time === '10:00'));

  const { rows: n } = await db.query(`
    select n.kind, n.status from notifications n join appointments a on a.id = n.appointment_id
     where a.cancel_token = $1 order by n.kind`, [token]);
  assert.deepEqual(n.map((x) => `${x.kind}:${x.status}`),
    ['confirmation:skipped', 'reminder:skipped', 'cancellation:scheduled']);
});

test('feriado del local (time_off sin barbero) → día cerrado', async () => {
  await db.query('insert into time_off (barber_id, starts_at, ends_at, reason) values (null, $1, $2, $3)',
    [zonedToUtc(WED, 0, tz), zonedToUtc(addDays(WED, 1), 0, tz), 'Feriado de ejemplo']);
  const { body } = await api.get(`/api/availability?serviceId=${SEED.corte}&date=${WED}`);
  assert.equal(body.reason, 'closed');
  assert.equal(body.slots.length, 0);
});

test('límite de reservas por celular', async () => {
  const phone = '3879990000';
  const times = ['17:00', '17:30', '19:00', '19:30', '20:00'];
  for (const t of times) {
    const r = await api.post('/api/appointments', booking({ barberId: SEED.fede, startsAt: iso(TUE, t), phone }));
    assert.equal(r.status, 201, t);
  }
  const r = await api.post('/api/appointments', booking({ barberId: SEED.fede, startsAt: iso(TUE, '20:30'), phone }));
  assert.equal(r.status, 429);
});

test('ruta inexistente y health', async () => {
  assert.equal((await api.get('/api/nada')).status, 404);
  assert.deepEqual((await api.get('/health')).body, { ok: true });
});
