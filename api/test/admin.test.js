import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { createTestDb, createUser, signTestToken, startApp, SEED } from './helpers.js';
import { addDays, localDate, weekday, zonedToUtc } from '../src/lib/time.js';

const tz = 'America/Argentina/Salta';
let db; let api; let token; let outsiderToken;

function next(wd) {
  let d = addDays(localDate(new Date(), tz), 2);
  while (weekday(d) !== wd) d = addDays(d, 1);
  return d;
}
const TUE = next(2);
const MON = next(1);
const iso = (date, hhmm) => zonedToUtc(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), tz).toISOString();

before(async () => {
  db = await createTestDb();
  api = await startApp({ db });
  token = await signTestToken(await createUser(db, { email: 'duenio@ejemplo.test' }));
  outsiderToken = await signTestToken(await createUser(db, { email: 'otro@ejemplo.test', admin: false }));
});
after(async () => { await api.close(); await db.close(); });

test('sin token → 401; token sin permiso → 403; token falsificado → 401', async () => {
  assert.equal((await api.get(`/api/admin/agenda?date=${TUE}`)).status, 401);
  assert.equal((await api.get(`/api/admin/agenda?date=${TUE}`, outsiderToken)).status, 403);
  const forged = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('x').setAudience('authenticated')
    .sign(new TextEncoder().encode('otra-clave-cualquiera-de-32-caracteres!!'));
  assert.equal((await api.get(`/api/admin/agenda?date=${TUE}`, forged)).status, 401);
  assert.equal((await api.get('/api/admin/me', token)).body.email, 'duenio@ejemplo.test');
});

let manualId;

test('turno manual: celular opcional, sin aviso mínimo, aparece en la agenda', async () => {
  const r = await api.post('/api/admin/appointments', {
    serviceId: SEED.corte, barberId: SEED.fede, startsAt: iso(TUE, '09:00'), name: 'Pibe sin celular',
  }, token);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.source, 'manual');
  assert.equal(r.body.customer.phone, null);
  assert.deepEqual(r.body.notifications.map((n) => n.status), ['skipped', 'skipped']);
  manualId = r.body.id;

  const clash = await api.post('/api/admin/appointments', {
    serviceId: SEED.corte, barberId: SEED.fede, startsAt: iso(TUE, '09:15'), name: 'Otro', phone: '387 4111111',
  }, token);
  assert.equal(clash.status, 409);
});

test('agenda del día: barberos con horario, turnos y resumen', async () => {
  await api.post('/api/appointments', {
    serviceId: SEED.corteBarba, startsAt: iso(TUE, '17:00'), barberId: SEED.nico, name: 'Online Prueba', phone: '3874222222',
  });
  const { status, body } = await api.get(`/api/admin/agenda?date=${TUE}`, token);
  assert.equal(status, 200);
  assert.equal(body.barbers.length, 2);
  assert.deepEqual(body.barbers[0].ranges, [{ start: '09:00', end: '13:00' }, { start: '17:00', end: '21:00' }]);
  assert.equal(body.barbers[0].closed, false);
  assert.deepEqual(body.appointments.map((a) => `${a.time} ${a.barberName}`), ['09:00 Fede (ejemplo)', '17:00 Nico (ejemplo)']);
  assert.equal(body.appointments[1].customer.phone, '+5493874222222');
  assert.equal(body.appointments[1].notifications.reminder, 'scheduled');
  assert.equal(body.summary.total, 2);
  assert.equal(body.summary.next.time, '09:00');

  const mon = await api.get(`/api/admin/agenda?date=${MON}`, token);
  assert.ok(mon.body.barbers.every((b) => b.closed));
});

test('detalle del turno con historial del cliente', async () => {
  const { status, body } = await api.get(`/api/admin/appointments/${manualId}`, token);
  assert.equal(status, 200);
  assert.equal(body.customer.name, 'Pibe sin celular');
  assert.equal(body.customer.history.total, 0);
  assert.equal(body.notifications.length, 2);
  assert.equal((await api.get('/api/admin/appointments/00000000-0000-4000-8000-00000000dead', token)).status, 404);
});

test('cambios de estado: no vino suma falta, deshacer la resta, cancelar avisa', async () => {
  const noShow = await api.patch(`/api/admin/appointments/${manualId}`, { status: 'no_show' }, token);
  assert.equal(noShow.status, 200);
  assert.equal(noShow.body.status, 'no_show');
  assert.equal(noShow.body.customer.noShowCount, 1);

  const undo = await api.patch(`/api/admin/appointments/${manualId}`, { status: 'booked' }, token);
  assert.equal(undo.body.status, 'booked');
  assert.equal(undo.body.customer.noShowCount, 0);

  const agenda = (await api.get(`/api/admin/agenda?date=${TUE}`, token)).body;
  const online = agenda.appointments.find((a) => a.time === '17:00');
  const cancel = await api.patch(`/api/admin/appointments/${online.id}`, { status: 'cancelled_by_shop' }, token);
  assert.equal(cancel.body.status, 'cancelled_by_shop');
  assert.ok(cancel.body.cancelledAt);
  assert.deepEqual(cancel.body.notifications.map((n) => `${n.kind}:${n.status}`),
    ['confirmation:skipped', 'reminder:skipped', 'cancellation:scheduled']);

  const revive = await api.patch(`/api/admin/appointments/${online.id}`, { status: 'booked' }, token);
  assert.equal(revive.status, 409);
  assert.equal(revive.body.error.code, 'INVALID_TRANSITION');

  const bad = await api.patch(`/api/admin/appointments/${manualId}`, { status: 'cancelled_by_customer' }, token);
  assert.equal(bad.status, 400);
});

test('el dueño ve horarios aunque falte menos que el aviso mínimo', async () => {
  const today = localDate(new Date(), tz);
  const pub = await api.get(`/api/availability?serviceId=${SEED.corte}&date=${addDays(today, 40)}`);
  assert.equal(pub.body.reason, 'out_of_window');
  const adm = await api.get(`/api/admin/availability?serviceId=${SEED.corte}&date=${addDays(today, 40)}`, token);
  assert.notEqual(adm.body.reason, 'out_of_window');
});
