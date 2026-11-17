// Base de datos de prueba: Postgres real (PGlite, en memoria) con la migración y el seed del proyecto.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createPgliteDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createJwtVerifier } from '../src/auth.js';
import { SignJWT } from 'jose';

const supabaseDir = fileURLToPath(new URL('../../supabase/', import.meta.url));
const sql = (file) => readFileSync(supabaseDir + file, 'utf8')
  .split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

export async function createTestDb({ seed = true } = {}) {
  const pglite = new PGlite({ extensions: { btree_gist, pgcrypto } });
  await pglite.exec(sql('tests/supabase_stub.sql'));
  await pglite.exec(sql('migrations/20261117000000_init.sql'));
  if (seed) await pglite.exec(sql('seed.sql'));
  return createPgliteDb(pglite);
}

// ---------------------------------------------------------------- Auth de prueba (HS256, como Supabase legacy)
export const TEST_JWT_SECRET = 'secreto-de-prueba-solo-para-tests-0123456789';
export const testVerifier = createJwtVerifier({ jwtSecret: TEST_JWT_SECRET });

export async function signTestToken({ userId, email }) {
  return new SignJWT({ email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));
}

/** Crea un usuario en auth.users (stub) y opcionalmente lo hace admin. */
export async function createUser(db, { email, admin = true }) {
  const { rows: [u] } = await db.query('insert into auth.users (email) values ($1) returning id', [email]);
  if (admin) await db.query('insert into admins (user_id) values ($1)', [u.id]);
  return { userId: u.id, email };
}

/** Levanta la app en un puerto libre y devuelve un cliente fetch mínimo. */
export async function startApp(opts) {
  const app = createApp({ rateLimit: false, verifyToken: testVerifier, ...opts });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  return {
    base,
    get: (p, token) => call('GET', p, undefined, token),
    post: (p, b, token) => call('POST', p, b, token),
    patch: (p, b, token) => call('PATCH', p, b, token),
    del: (p, token) => call('DELETE', p, undefined, token),
    close: () => new Promise((r) => server.close(r)),
  };
}

export const SEED = {
  nico: '00000000-0000-4000-8000-000000000b01',
  fede: '00000000-0000-4000-8000-000000000b02',
  corte: '00000000-0000-4000-8000-000000000501',
  corteBarba: '00000000-0000-4000-8000-000000000502',
  barba: '00000000-0000-4000-8000-000000000503',
};
