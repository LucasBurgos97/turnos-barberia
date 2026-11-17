import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createTestDb, createUser, signTestToken, startApp, SEED } from './helpers.js';
import { buildMessage, relativeDayLabel, dayLabel } from '../src/whatsapp/templates.js';
import { createCloudApiSender } from '../src/whatsapp/sender.js';
import { processDue, createNotifier } from '../src/whatsapp/dispatcher.js';
import { applyStatuses, verifySignature } from '../src/whatsapp/webhook.js';
import { addDays, localDate, zonedToUtc } from '../src/lib/time.js';

const tz = 'America/Argentina/Salta';
const WEB = 'https://turnos.ejemplo.test';
const at = (date, hhmm) => zonedToUtc(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), tz);
const minutes = (d, m) => new Date(d.getTime() + m * 60000);

/** Crea un turno real (dispara el trigger que encola confirmación + recordatorio). */
async function book(db, { date, time, phone = '+5493874000001', name = 'Juan Pérez' }) {
  const { rows: [c] } = await db.query(
    `insert into customers (name, phone) values ($1, $2)
     on conflict (phone) do update set name = excluded.name returning id`, [name, phone]);
  const start = at(date, time);
  const { rows: [a] } = await db.query(`
    insert into appointments (barber_id, service_id, customer_id, starts_at, ends_at, service_name_snapshot, price_snapshot)
    values ($1, $2, $3, $4, $5, 'Corte', 10000) returning id, cancel_token`,
  [SEED.nico, SEED.corte, c.id, start, minutes(start, 30)]);
  return a;
}
const notifs = async (db, apptId) => Object.fromEntries((await db.query(
  'select kind, status, attempts, error, provider_message_id, scheduled_for from notifications where appointment_id = $1', [apptId],
)).rows.map((r) => [r.kind, r]));

let msgSeq = 0;
function fakeSender() {
  const sent = [];
  const send = async (msg) => { sent.push(msg); msgSeq += 1; return { id: `wamid.TEST.${msgSeq}` }; };
  return { send, sent };
}

describe('plantillas', () => {
  const now = new Date('2026-11-17T15:00:00Z'); // martes 12:00 en Salta
  const row = {
    customer_name: '  Martín  Gómez ', shop_name: 'Barbería Ejemplo', barber_name: 'Nico (ejemplo)',
    starts_at: new Date('2026-11-19T20:30:00Z'), cancel_token: 'abc123', timezone: tz,
  };

  test('confirmación: 6 parámetros en orden y link de gestión', () => {
    const m = buildMessage('confirmation', row, { webUrl: `${WEB}/`, now });
    assert.equal(m.template, 'turno_confirmado');
    assert.deepEqual(m.params, ['Martín', 'Barbería Ejemplo', 'jueves 19/11', '17:30', 'Nico', `${WEB}/t/abc123`]);
    assert.match(m.text, /^Hola Martín, tu turno en Barbería Ejemplo quedó confirmado: jueves 19\/11 a las 17:30 con Nico\./);
  });

  test('recordatorio dice hoy / mañana / el día', () => {
    assert.equal(relativeDayLabel('2026-11-17', now, tz), 'hoy');
    assert.equal(relativeDayLabel('2026-11-18', now, tz), 'mañana');
    assert.equal(relativeDayLabel('2026-11-19', now, tz), 'el jueves 19/11');
    const m = buildMessage('reminder', row, { webUrl: WEB, now });
    assert.deepEqual(m.params, ['Martín', 'Barbería Ejemplo', 'el jueves 19/11', '17:30', `${WEB}/t/abc123`]);
  });

  test('cancelación lleva al inicio para sacar otro', () => {
    const m = buildMessage('cancellation', row, { webUrl: WEB, now });
    assert.equal(m.params.at(-1), `${WEB}/`);
    assert.equal(dayLabel('2026-12-01'), 'martes 1/12');
  });
});

describe('cliente de la Cloud API', () => {
  test('arma el pedido de plantilla como pide Meta', async () => {
    let call;
    const send = createCloudApiSender({
      token: 'tok', phoneNumberId: '123',
      fetchImpl: async (url, opts) => { call = { url, ...opts, body: JSON.parse(opts.body) }; return new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] })); },
    });
    const r = await send({ to: '+5493874000001', template: 'turno_confirmado', params: ['a', 'b'] });
    assert.equal(r.id, 'wamid.X');
    assert.equal(call.url, 'https://graph.facebook.com/v21.0/123/messages');
    assert.equal(call.headers.authorization, 'Bearer tok');
    assert.equal(call.body.to, '5493874000001');
    assert.equal(call.body.template.language.code, 'es_AR');
    assert.deepEqual(call.body.template.components[0].parameters, [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]);
  });

  test('clasifica errores: límite de envíos se reintenta, número inválido no', async () => {
    const mk = (status, error) => createCloudApiSender({
      token: 't', phoneNumberId: '1', fetchImpl: async () => new Response(JSON.stringify({ error }), { status }),
    });
    await assert.rejects(mk(429, { code: 130429, message: 'Rate limit' })({ to: '+1', template: 'x', params: [] }),
      (e) => e.retryable === true);
    await assert.rejects(mk(400, { code: 131026, message: 'Message undeliverable' })({ to: '+1', template: 'x', params: [] }),
      (e) => e.retryable === false && /undeliverable/.test(e.message));
    const down = createCloudApiSender({ token: 't', phoneNumberId: '1', fetchImpl: async () => { throw new Error('ECONNRESET'); } });
    await assert.rejects(down({ to: '+1', template: 'x', params: [] }), (e) => e.retryable === true);
  });
});

describe('despacho de la cola', () => {
  let db;
  const D = addDays(localDate(new Date(), tz), 3);
  before(async () => { db = await createTestDb(); });
  after(async () => { await db.close(); });

  test('manda la confirmación ya y el recordatorio recién a su hora', async () => {
    const a = await book(db, { date: D, time: '17:00' });
    const { send, sent } = fakeSender();

    const r1 = await processDue(db, send, new Date(), { webUrl: WEB });
    assert.equal(r1.sent, 1);
    assert.equal(sent[0].template, 'turno_confirmado');
    assert.equal(sent[0].to, '+5493874000001');
    let n = await notifs(db, a.id);
    assert.equal(n.confirmation.status, 'sent');
    assert.match(n.confirmation.provider_message_id, /^wamid\.TEST\.\d+$/);
    assert.equal(n.reminder.status, 'scheduled');

    // Correr de nuevo no duplica
    assert.equal((await processDue(db, send, new Date(), { webUrl: WEB })).sent, 0);

    // A la hora del recordatorio (3 h antes)
    const r2 = await processDue(db, send, at(D, '14:00'), { webUrl: WEB });
    assert.equal(r2.sent, 1);
    assert.equal(sent[1].template, 'turno_recordatorio');
    n = await notifs(db, a.id);
    assert.equal(n.reminder.status, 'sent');
  });

  test('falla transitoria: reintenta con espera; a los 3 intentos queda fallido', async () => {
    const a = await book(db, { date: D, time: '18:00', phone: '+5493874000002' });
    const flaky = async () => { throw Object.assign(new Error('Meta caído'), { retryable: true }); };
    let now = new Date();

    let r = await processDue(db, flaky, now, { webUrl: WEB });
    assert.equal(r.retried, 1);
    let n = await notifs(db, a.id);
    assert.equal(n.confirmation.status, 'scheduled');
    assert.equal(n.confirmation.attempts, 1);
    assert.equal(n.confirmation.error, 'Meta caído');
    assert.ok(n.confirmation.scheduled_for > now, 'espera antes de reintentar');

    now = minutes(now, 6);
    await processDue(db, flaky, now, { webUrl: WEB });
    now = minutes(now, 11);
    r = await processDue(db, flaky, now, { webUrl: WEB });
    assert.equal(r.failed, 1);
    n = await notifs(db, a.id);
    assert.equal(n.confirmation.status, 'failed');
    assert.equal(n.confirmation.attempts, 3);
  });

  test('error definitivo (número sin WhatsApp) → fallido al primer intento', async () => {
    const a = await book(db, { date: D, time: '19:00', phone: '+5493874000003' });
    const bad = async () => { throw Object.assign(new Error('Message undeliverable'), { retryable: false }); };
    const r = await processDue(db, bad, new Date(), { webUrl: WEB });
    assert.equal(r.failed, 1);
    assert.equal((await notifs(db, a.id)).confirmation.status, 'failed');
  });

  test('recordatorio de un turno que ya empezó no sale', async () => {
    const a = await book(db, { date: D, time: '20:00', phone: '+5493874000004' });
    await db.query("update notifications set status = 'sent' where appointment_id = $1 and kind = 'confirmation'", [a.id]);
    const { send, sent } = fakeSender();
    const r = await processDue(db, send, at(D, '20:05'), { webUrl: WEB });
    assert.equal(sent.filter((m) => m.template === 'turno_recordatorio' && m.to === '+5493874000004').length, 0);
    assert.ok(r.skipped >= 1);
    assert.equal((await notifs(db, a.id)).reminder.error, 'el turno ya empezó');
  });

  test('un "sending" colgado (se cayó el proceso) se retoma', async () => {
    const a = await book(db, { date: D, time: '09:00', phone: '+5493874000005' });
    await db.query(`update notifications set status = 'sending', updated_at = now() - interval '20 minutes'
                     where appointment_id = $1 and kind = 'confirmation'`, [a.id]);
    // el trigger de updated_at pisa el valor: lo forzamos sin trigger
    await db.query('alter table notifications disable trigger notifications_updated_at');
    await db.query(`update notifications set updated_at = now() - interval '20 minutes'
                     where appointment_id = $1 and kind = 'confirmation'`, [a.id]);
    await db.query('alter table notifications enable trigger notifications_updated_at');
    const { send } = fakeSender();
    await processDue(db, send, new Date(), { webUrl: WEB });
    assert.equal((await notifs(db, a.id)).confirmation.status, 'sent');
  });

  test('notifier.kick() no corre dos despachos a la vez', async () => {
    let concurrent = 0; let max = 0;
    const send = async () => { concurrent += 1; max = Math.max(max, concurrent); await new Promise((r) => setTimeout(r, 5)); concurrent -= 1; return { id: null }; };
    await book(db, { date: D, time: '10:00', phone: '+5493874000006' });
    await book(db, { date: D, time: '11:00', phone: '+5493874000007' });
    const notifier = createNotifier({ db, send, webUrl: WEB });
    await Promise.all([notifier.kick(), notifier.kick(), notifier.kick()]);
    assert.equal(max, 1);
  });
});

describe('webhook de estados', () => {
  let db;
  before(async () => {
    db = await createTestDb();
    const a = await book(db, { date: addDays(localDate(new Date(), tz), 3), time: '17:00' });
    await db.query(`update notifications set status = 'sent', provider_message_id = 'wamid.W1'
                     where appointment_id = $1 and kind = 'confirmation'`, [a.id]);
  });
  after(async () => { await db.close(); });

  const payload = (status, extra = {}) => ({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.W1', status, ...extra }] } }] }],
  });
  const statusOf = async () => (await db.query("select status, error from notifications where provider_message_id = 'wamid.W1'")).rows[0];

  test('firma HMAC', () => {
    const body = Buffer.from('{"a":1}');
    const sig = `sha256=${createHmac('sha256', 's3cr3t').update(body).digest('hex')}`;
    assert.equal(verifySignature(body, sig, 's3cr3t'), true);
    assert.equal(verifySignature(body, sig, 'otro'), false);
    assert.equal(verifySignature(body, 'sha256=00', 's3cr3t'), false);
    assert.equal(verifySignature(body, undefined, 's3cr3t'), false);
  });

  test('entregado → leído, y nunca vuelve para atrás', async () => {
    await applyStatuses(db, payload('delivered'));
    assert.equal((await statusOf()).status, 'delivered');
    await applyStatuses(db, payload('read'));
    assert.equal((await statusOf()).status, 'read');
    await applyStatuses(db, payload('delivered'));
    assert.equal((await statusOf()).status, 'read');
  });

  test('falló: guarda el motivo', async () => {
    await db.query("update notifications set status = 'sent' where provider_message_id = 'wamid.W1'");
    await applyStatuses(db, payload('failed', { errors: [{ code: 131026, title: 'Message undeliverable' }] }));
    const s = await statusOf();
    assert.equal(s.status, 'failed');
    assert.match(s.error, /undeliverable.*131026/);
  });
});

describe('endpoints de WhatsApp', () => {
  let db; let api; let token;
  const CRON = 'cron-secreto-de-prueba';
  const APP_SECRET = 'app-secret-de-prueba';
  let fake;

  before(async () => {
    db = await createTestDb();
    fake = fakeSender();
    const notifier = createNotifier({ db, send: fake.send, webUrl: WEB });
    api = await startApp({ db, notifier, cronSecret: CRON, webhook: { verifyToken: 'verify-me', appSecret: APP_SECRET } });
    token = await signTestToken(await createUser(db, { email: 'duenio@ejemplo.test' }));
  });
  after(async () => { await api.close(); await db.close(); });

  test('cron: sin secreto 401, con secreto manda', async () => {
    await book(db, { date: addDays(localDate(new Date(), tz), 3), time: '17:00' });
    const bad = await fetch(`${api.base}/internal/reminders/run`, { method: 'POST', headers: { 'x-cron-secret': 'nop' } });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${api.base}/internal/reminders/run`, { method: 'POST', headers: { 'x-cron-secret': CRON } });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(typeof body.sent, 'number');
  });

  test('verificación del webhook', async () => {
    const ok = await fetch(`${api.base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42`);
    assert.equal(await ok.text(), '42');
    const bad = await fetch(`${api.base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=42`);
    assert.equal(bad.status, 403);
  });

  test('webhook POST exige firma', async () => {
    const body = JSON.stringify({ entry: [] });
    const unsigned = await fetch(`${api.base}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(unsigned.status, 401);
    const sig = `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
    const signed = await fetch(`${api.base}/webhooks/whatsapp`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body,
    });
    assert.equal(signed.status, 200);
  });

  test('reservar online manda la confirmación sin esperar al cron', async () => {
    const date = addDays(localDate(new Date(), tz), 2);
    let d = date;
    while (![2, 3, 4, 5].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, 1);
    const before = fake.sent.length;
    const r = await api.post('/api/appointments', {
      serviceId: SEED.corte, barberId: SEED.fede, startsAt: at(d, '12:00').toISOString(), name: 'Rápido Prueba', phone: '3874999999',
    });
    assert.equal(r.status, 201);
    for (let i = 0; i < 250 && fake.sent.length === before; i += 1) await new Promise((res) => setTimeout(res, 20));
    assert.equal(fake.sent.at(-1).to, '+5493874999999');
    assert.equal(fake.sent.at(-1).template, 'turno_confirmado');
  });

  test('panel: lista de mensajes y reintento de un fallido', async () => {
    const { rows: [n] } = await db.query(`update notifications set status = 'failed', error = 'x', attempts = 3
      where id = (select id from notifications where status = 'scheduled' limit 1) returning id`);
    const list = await api.get('/api/admin/notifications?filter=failed', token);
    assert.equal(list.status, 200);
    assert.equal(list.body.whatsappEnabled, true);
    assert.ok(list.body.items.some((i) => i.id === n.id));
    assert.ok(list.body.counts.failed >= 1);

    const retry = await api.post(`/api/admin/notifications/${n.id}/retry`, null, token);
    assert.equal(retry.status, 200);
    const again = await api.post(`/api/admin/notifications/${n.id}/retry`, null, token);
    assert.equal(again.status, 409);
    assert.equal((await api.get('/api/admin/notifications?filter=nada', token)).status, 400);
  });
});
