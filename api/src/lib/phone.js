// Normaliza celulares a E.164 para WhatsApp.
// Argentina: +54 9 <código de área sin 0><número sin 15>  → siempre 10 dígitos después del 9.
// Acepta lo que escribe la gente en Salta: "387 15 412-3456", "0387 154123456",
// "154123456" (sin característica → se asume la del local), "+54 9 387 4123456", etc.
// Números extranjeros (turistas) se aceptan si vienen con + y código de país.

// Características de 3 dígitos. "11" es la única de 2; el resto son de 4.
const AREA_3 = new Set([
  '220', '221', '223', '230', '236', '237', '249', '260', '261', '263', '264', '266',
  '280', '291', '294', '297', '298', '299', '336', '341', '342', '343', '345', '348',
  '351', '353', '358', '362', '364', '370', '376', '379', '380', '381', '383', '385',
  '387', '388',
]);

function areaLength(n) {
  if (n.startsWith('11')) return 2;
  if (AREA_3.has(n.slice(0, 3))) return 3;
  return 4;
}

/**
 * @param {string} input lo que escribió el cliente
 * @param {{ defaultArea?: string }} [opts] característica a usar si no la puso (Salta capital: 387)
 * @returns {string|null} '+549XXXXXXXXXX', '+<extranjero>' o null si no es válido
 */
export function normalizePhone(input, { defaultArea = '387' } = {}) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  const hasPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (!hasPlus && digits.startsWith('00')) {
    // 00 + código de país
    digits = digits.slice(2);
    return normalizePhone(`+${digits}`, { defaultArea });
  }

  if (hasPlus && !digits.startsWith('54')) {
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0' ? `+${digits}` : null;
  }

  let n;
  if (digits.startsWith('54') && (hasPlus || digits.length >= 12)) {
    n = digits.slice(2);
    if (n.startsWith('9')) n = n.slice(1);
    if (n.startsWith('0')) n = n.slice(1);
  } else {
    n = digits.startsWith('0') ? digits.slice(1) : digits;
  }

  // Sin característica: "15 4123456" o "4123456" (Salta capital: 387 + 7 dígitos = 10)
  const localLen = 10 - defaultArea.length;
  if (n.length === localLen + 2 && n.startsWith('15')) n = n.slice(2);
  if (n.length === localLen) n = defaultArea + n;

  // Con 15 después de la característica: 12 dígitos
  // Si no está donde lo espera la característica (ej. 3876 vs 387), se prueba 4 → 3 → 2.
  if (n.length === 12) {
    const al = [areaLength(n), 4, 3, 2].find((len) => n.slice(len, len + 2) === '15');
    if (al) n = n.slice(0, al) + n.slice(al + 2);
  }

  if (n.length !== 10 || !/^[1-3]/.test(n)) return null;
  return `+549${n}`;
}

/** '+5493871234567' → '···4567' (para mostrar sin exponer el número entero). */
export function maskPhone(e164) {
  if (!e164) return null;
  return `···${e164.slice(-4)}`;
}
