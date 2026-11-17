// Acceso a la base. La API usa una interfaz mínima para poder probarla con PGlite:
//   db.query(text, params) → { rows }
//   db.tx(async (q) => …)  → q.query(text, params) dentro de una transacción
import pg from 'pg';

// timestamptz → Date (default de pg). time → 'HH:MM:SS' (default). bigint → number (los Nº de turno caben).
pg.types.setTypeParser(20, (v) => Number(v));

/**
 * Conexión a Supabase. Usar el connection string del **pooler** (Project Settings → Database →
 * Connection pooling, puerto 6543 o 5432 "session"): Render no tiene IPv6 y la conexión directa
 * de Supabase sí lo requiere.
 */
export function createPgDb(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  return {
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({ query: (t, p) => client.query(t, p) });
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** Adaptador para PGlite (tests). */
export function createPgliteDb(pglite) {
  return {
    query: (text, params) => pglite.query(text, params),
    tx: (fn) => pglite.transaction((tx) => fn({ query: (t, p) => tx.query(t, p) })),
    close: () => pglite.close(),
  };
}
