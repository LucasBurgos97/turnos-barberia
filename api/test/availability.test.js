import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSlots, pickBarber } from '../src/lib/availability.js';
import { zonedToUtc, localDate, localTime, addDays, weekday } from '../src/lib/time.js';

const tz = 'America/Argentina/Salta';
const date = '2026-11-24'; // martes
const at = (hhmm) => zonedToUtc(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), tz);
const split = [{ start: 9 * 60, end: 13 * 60 }, { start: 17 * 60, end: 21 * 60 }];
const base = { date, tz, durationMin: 30, stepMin: 15, earliest: null, blocks: [], booked: [] };

test('helpers de zona horaria: Salta es UTC-3', () => {
  assert.equal(at('09:00').toISOString(), '2026-11-24T12:00:00.000Z');
  assert.equal(at('21:30').toISOString(), '2026-11-25T00:30:00.000Z');
  assert.equal(localDate(new Date('2026-11-25T02:00:00Z'), tz), '2026-11-24');
  assert.equal(localTime(new Date('2026-11-25T02:00:00Z'), tz), '23:00');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekday(date), 2);
});

test('horario cortado: no ofrece turnos en la siesta ni que terminen después del cierre', () => {
  const slots = computeSlots({ ...base, barbers: [{ id: 'a', ranges: split }] });
  const times = slots.map((s) => s.time);
  assert.equal(times[0], '09:00');
  assert.ok(times.includes('12:30'));
  assert.ok(!times.includes('12:45'), '12:45 + 30 min pasa las 13:00');
  assert.ok(!times.some((t) => t >= '13:00' && t < '17:00'), 'siesta');
  assert.equal(times.at(-1), '20:30');
  assert.equal(slots.length, 30);
});

test('turno tomado bloquea solo los horarios que se pisan', () => {
  const booked = [{ barberId: 'a', start: at('10:00'), end: at('10:45') }];
  const times = computeSlots({ ...base, booked, barbers: [{ id: 'a', ranges: split }] }).map((s) => s.time);
  assert.ok(times.includes('09:30'), '09:30–10:00 queda pegado, sirve');
  assert.ok(!times.includes('09:45'));
  assert.ok(!times.includes('10:30'));
  assert.ok(times.includes('10:45'));
});

test('aviso mínimo y bloqueos del local', () => {
  const earliest = at('11:10');
  const blocks = [{ barberId: null, start: at('17:00'), end: at('21:00') }];
  const times = computeSlots({ ...base, earliest, blocks, barbers: [{ id: 'a', ranges: split }] }).map((s) => s.time);
  assert.deepEqual(times, ['11:15', '11:30', '11:45', '12:00', '12:15', '12:30']);
});

test('varios barberos: un horario lista quiénes están libres', () => {
  const booked = [{ barberId: 'a', start: at('09:00'), end: at('09:30') }];
  const slots = computeSlots({ ...base, booked, barbers: [{ id: 'a', ranges: split }, { id: 'b', ranges: split }] });
  assert.deepEqual(slots.find((s) => s.time === '09:00').barberIds, ['b']);
  assert.deepEqual(slots.find((s) => s.time === '09:30').barberIds, ['a', 'b']);
});

test('pickBarber: el menos cargado, y a igualdad el primero', () => {
  assert.equal(pickBarber(['a', 'b'], []), 'a');
  assert.equal(pickBarber(['a', 'b'], [{ barberId: 'a' }]), 'b');
  assert.equal(pickBarber([], []), null);
});
