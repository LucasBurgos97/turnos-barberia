import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, maskPhone } from '../src/lib/phone.js';

const SALTA = '+5493874123456';

test('formas en que la gente escribe un celular de Salta', () => {
  for (const input of [
    '387 15 412-3456',
    '0387 15 4123456',
    '(0387) 154-123456',
    '3874123456',
    '387-412-3456',
    '154123456',          // sin característica
    '4123456',            // sin característica ni 15
    '+54 9 387 412-3456',
    '+54 387 4123456',    // sin el 9
    '+54 9 387 15 4123456',
    '5493874123456',
    '0054 9 387 4123456',
  ]) {
    assert.equal(normalizePhone(input), SALTA, input);
  }
});

test('otras características argentinas', () => {
  assert.equal(normalizePhone('11 15 2345-6789'), '+5491123456789');        // CABA (2 dígitos)
  assert.equal(normalizePhone('0351 15 512 3456'), '+5493515123456');        // Córdoba (3)
  assert.equal(normalizePhone('03876 15 412345'), '+5493876412345');         // Tartagal (4)
  assert.equal(normalizePhone('388 4123456'), '+5493884123456');             // Jujuy
});

test('característica por defecto configurable', () => {
  assert.equal(normalizePhone('15412345', { defaultArea: '3876' }), '+5493876412345');
});

test('extranjeros con código de país', () => {
  assert.equal(normalizePhone('+56 9 8765 4321'), '+56987654321');           // Chile
  assert.equal(normalizePhone('+591 71234567'), '+59171234567');             // Bolivia
});

test('inválidos', () => {
  for (const input of ['', 'hola', '123', '387 412', '+0 123456789', '99 1234 5678', null, undefined]) {
    assert.equal(normalizePhone(input), null, String(input));
  }
});

test('maskPhone muestra solo los últimos 4', () => {
  assert.equal(maskPhone(SALTA), '···3456');
  assert.equal(maskPhone(null), null);
});
