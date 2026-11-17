import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createUser, signTestToken, startApp, SEED } from './helpers.js';
import { addDays, localDate, weekday, zonedToUtc } from '../src/lib/time.js';

const tz = 'America/Argentina/Salta';
let db; let api; let token;

function next(wd, from = 2) {
  let d = addDays(localDate(new Date(), tz), from);
  while (weekday(d) !== wd) d = addDays(d, 1);
  return d;
}
const TUE = next(2);
const WED = next(3);
const at = (date, hhmm) => zonedToUtc(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), tz).toISOString();
const avail = async (serviceId, date, barberId) => (await api.get(
  `/api/availability?serviceId=${serviceId}&date=${date}${barberId ? `&barberId=${barberId}` : ''}`,
)).body;

before(async () => {
  db = await createTestDb();
  api = await startApp({ db });
  token = await signTestToken(await createUser(db, { email: 'duenio@ejemplo.test' }));
});
after(async () => { await api.close(); await db.close(); });

test('todo lo de configuración exige sesión', async () => {
  for (const p of ['/api/admin/services', '/api/admin/barbers', '/api/admin/time-off', '/api/admin/settings']) {
    assert.equal((await api.get(p)).status, 401, p);
  }
});

let svcId;

test('servicios: crear, validar, editar, desactivar y reordenar', async () => {
  const bad = await api.post('/api/admin/services', { name: 'X', durationMin: 0, priceArs: -1 }, token);
  assert.equal(bad.status, 400);

  const r = await api.post('/api/admin/services', {
    name: 'Perfilado de cejas', durationMin: 15, priceArs: 3000, barberIds: [SEED.fede],
  }, token);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  svcId = r.body.id;
  assert.deepEqual(r.body.barberIds, [SEED.fede]);
  assert.equal(r.body.sortOrder, 5);

  // Aparece para reservar online, solo con Fede
  const shop = (await api.get('/api/shop')).body;
  assert.deepEqual(shop.services.find((s) => s.id === svcId).barberIds, [SEED.fede]);

  const edit = await api.patch(`/api/admin/services/${svcId}`, { priceArs: 3500, barberIds: [SEED.nico, SEED.fede] }, token);
  assert.equal(edit.body.priceArs, 3500);
  assert.equal(edit.body.name, 'Perfilado de cejas');
  assert.equal(edit.body.barberIds.length, 2);

  await api.patch(`/api/admin/services/${svcId}`, { active: false }, token);
  assert.ok(!(await api.get('/api/shop')).body.services.some((s) => s.id === svcId), 'inactivo no se ofrece');

  const list = (await api.get('/api/admin/services', token)).body;
  const ids = list.map((s) => s.id).reverse();
  const reordered = await api.post('/api/admin/services/reorder', { ids }, token);
  assert.deepEqual(reordered.body.map((s) => s.id), ids);

  assert.equal((await api.patch('/api/admin/services/00000000-0000-4000-8000-00000000dead', { priceArs: 1 }, token)).status, 404);
});

let newBarber;

test('barberos: alta con horario cortado y servicios; aparece en la disponibilidad', async () => {
  const r = await api.post('/api/admin/barbers', {
    name: 'Lucho',
    serviceIds: [SEED.corte],
    hours: [{ weekday: 3, start: '10:00', end: '13:00' }, { weekday: 3, start: '16:00', end: '20:00' }],
  }, token);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  newBarber = r.body.id;
  assert.equal(r.body.hours.length, 2);

  const a = await avail(SEED.corte, WED, newBarber);
  assert.equal(a.slots[0].time, '10:00');
  assert.ok(a.slots.some((s) => s.time === '16:00'));
  assert.ok(!a.slots.some((s) => s.time === '14:00'));
  // No hace barba → 404 al pedirle barba
  assert.equal((await api.get(`/api/availability?serviceId=${SEED.barba}&date=${WED}&barberId=${newBarber}`)).status, 404);
});

test('barberos: tramos pisados o al revés → 400; cambiar horario reemplaza el anterior', async () => {
  const overlap = await api.patch(`/api/admin/barbers/${newBarber}`, {
    hours: [{ weekday: 2, start: '09:00', end: '13:00' }, { weekday: 2, start: '12:00', end: '15:00' }],
  }, token);
  assert.equal(overlap.status, 400);
  assert.equal(overlap.body.error.code, 'INVALID_HOURS');

  const backwards = await api.patch(`/api/admin/barbers/${newBarber}`, { hours: [{ weekday: 2, start: '13:00', end: '09:00' }] }, token);
  assert.equal(backwards.status, 400);

  const ok = await api.patch(`/api/admin/barbers/${newBarber}`, { hours: [{ weekday: 2, start: '09:00', end: '12:00' }] }, token);
  assert.deepEqual(ok.body.hours, [{ weekday: 2, start: '09:00', end: '12:00' }]);
  assert.equal((await avail(SEED.corte, WED, newBarber)).reason, 'closed');

  const off = await api.patch(`/api/admin/barbers/${newBarber}`, { active: false, photoUrl: '' }, token);
  assert.equal(off.body.active, false);
  assert.equal(off.body.photoUrl, null);
  assert.ok(!(await api.get('/api/shop')).body.barbers.some((b) => b.id === newBarber));
});

test('bloqueos: feriado de todo el local, horas sueltas de un barbero y aviso de turnos afectados', async () => {
  // Turno ya reservado el martes 17:00 con Nico
  const booked = await api.post('/api/appointments', {
    serviceId: SEED.corte, barberId: SEED.nico, startsAt: at(TUE, '17:00'), name: 'Afectado Prueba', phone: '3874777777',
  });
  assert.equal(booked.status, 201);

  const partial = await api.post('/api/admin/time-off', {
    barberId: SEED.nico, fromDate: TUE, toDate: TUE, fromTime: '16:00', toTime: '19:00', reason: 'Turno médico',
  }, token);
  assert.equal(partial.status, 201, JSON.stringify(partial.body));
  assert.deepEqual(partial.body.affected.map((a) => `${a.time} ${a.customerName}`), ['17:00 Afectado Prueba']);

  const nico = await avail(SEED.corte, TUE, SEED.nico);
  assert.ok(nico.slots.some((s) => s.time === '15:30') === false, 'fuera de horario igual');
  assert.ok(!nico.slots.some((s) => s.time === '18:00'), 'bloqueado');
  assert.ok(nico.slots.some((s) => s.time === '19:00'), 'después del bloqueo vuelve');
  assert.ok((await avail(SEED.corte, TUE, SEED.fede)).slots.some((s) => s.time === '18:00'), 'Fede no se ve afectado');

  const holiday = await api.post('/api/admin/time-off', { barberId: null, fromDate: WED, toDate: WED, reason: 'Feriado' }, token);
  assert.equal(holiday.status, 201);
  assert.equal((await avail(SEED.corte, WED)).reason, 'closed');

  const list = (await api.get('/api/admin/time-off', token)).body;
  const h = list.find((t) => t.id === holiday.body.id);
  assert.equal(h.allDay, true);
  assert.equal(h.fromDate, WED);
  assert.equal(h.toDate, WED);
  assert.equal(h.barberId, null);
  const p = list.find((t) => t.id === partial.body.id);
  assert.equal(p.allDay, false);
  assert.equal(p.fromTime, '16:00');
  assert.equal(p.barberName, 'Nico (ejemplo)');

  assert.equal((await api.del(`/api/admin/time-off/${holiday.body.id}`, token)).status, 200);
  assert.notEqual((await avail(SEED.corte, WED)).reason, 'closed');
  assert.equal((await api.del(`/api/admin/time-off/${holiday.body.id}`, token)).status, 404);

  const backwards = await api.post('/api/admin/time-off', { fromDate: WED, toDate: TUE < WED ? TUE : WED, fromTime: '12:00', toTime: '10:00' }, token);
  assert.equal(backwards.status, 400);
});

test('ajustes: leer, validar, normalizar WhatsApp y reprogramar recordatorios', async () => {
  const s = (await api.get('/api/admin/settings', token)).body;
  assert.equal(s.name, 'Barbería Ejemplo');
  assert.equal(s.reminderHoursBefore, 3);

  assert.equal((await api.patch('/api/admin/settings', { slotStepMin: 2 }, token)).status, 400);
  assert.equal((await api.patch('/api/admin/settings', { mapsUrl: 'no es url' }, token)).status, 400);
  const badPhone = await api.patch('/api/admin/settings', { whatsappPhone: '123' }, token);
  assert.equal(badPhone.body.error.code, 'INVALID_PHONE');

  const r = await api.patch('/api/admin/settings', {
    name: 'La Esquina (ejemplo)', whatsappPhone: '387 15 411-2233', address: 'Caseros 100, Salta', reminderHoursBefore: 24,
  }, token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.whatsappPhone, '+5493874112233');
  assert.equal(r.body.name, 'La Esquina (ejemplo)');
  assert.equal(r.body.mapsUrl, null, 'lo que no se manda no se toca');

  // El recordatorio pendiente del turno de las 17:00 ahora sale 24 h antes
  const { rows: [n] } = await db.query(`
    select n.scheduled_for, a.starts_at from notifications n join appointments a on a.id = n.appointment_id
     join customers c on c.id = a.customer_id
     where c.name = 'Afectado Prueba' and n.kind = 'reminder'`);
  assert.equal(a2h(n.starts_at) - a2h(n.scheduled_for), 24);

  const cleared = await api.patch('/api/admin/settings', { address: '' }, token);
  assert.equal(cleared.body.address, null);
  assert.equal((await api.get('/api/shop')).body.shop.name, 'La Esquina (ejemplo)');
});

const a2h = (d) => d.getTime() / 3_600_000;
