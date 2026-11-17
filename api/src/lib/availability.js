// Cálculo de horarios libres. Función pura: recibe todo lo que necesita y no toca la base.
import { zonedToUtc, localTime } from './time.js';

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/**
 * @param {object} p
 * @param {string} p.date              'YYYY-MM-DD' local
 * @param {string} p.tz                zona del local
 * @param {number} p.durationMin       duración del servicio
 * @param {number} p.stepMin           cada cuánto arrancan los turnos
 * @param {Date|null} p.earliest       primer inicio permitido (ahora + aviso mínimo); null = sin límite
 * @param {{id: string, ranges: {start: number, end: number}[]}[]} p.barbers  tramos del día en minutos locales
 * @param {{barberId: string|null, start: Date, end: Date}[]} p.blocks       time_off (barberId null = todo el local)
 * @param {{barberId: string, start: Date, end: Date}[]} p.booked            turnos vigentes
 * @returns {{ time: string, startsAt: Date, endsAt: Date, barberIds: string[] }[]}
 */
export function computeSlots({ date, tz, durationMin, stepMin, earliest, barbers, blocks, booked }) {
  const byTime = new Map();

  for (const barber of barbers) {
    const myBlocks = blocks.filter((b) => b.barberId === null || b.barberId === barber.id);
    const myBooked = booked.filter((a) => a.barberId === barber.id);

    for (const range of barber.ranges) {
      for (let m = range.start; m + durationMin <= range.end; m += stepMin) {
        const start = zonedToUtc(date, m, tz);
        const end = new Date(start.getTime() + durationMin * 60000);
        if (earliest && start < earliest) continue;
        if (myBlocks.some((b) => overlaps(start, end, b.start, b.end))) continue;
        if (myBooked.some((a) => overlaps(start, end, a.start, a.end))) continue;

        const key = start.getTime();
        if (!byTime.has(key)) {
          byTime.set(key, { time: localTime(start, tz), startsAt: start, endsAt: end, barberIds: [] });
        }
        byTime.get(key).barberIds.push(barber.id);
      }
    }
  }

  return [...byTime.values()].sort((a, b) => a.startsAt - b.startsAt);
}

/**
 * Para "cualquier barbero": el que tenga menos turnos ese día; a igualdad, el primero en el orden del local.
 * @param {string[]} candidateIds  barberos libres en ese horario, ya en el orden del local
 * @param {{barberId: string}[]} booked  turnos del día
 */
export function pickBarber(candidateIds, booked) {
  const load = (id) => booked.filter((a) => a.barberId === id).length;
  return [...candidateIds].sort((a, b) => load(a) - load(b) || candidateIds.indexOf(a) - candidateIds.indexOf(b))[0] ?? null;
}
