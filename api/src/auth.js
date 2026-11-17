// Autenticación del dueño: JWT de Supabase Auth + que el usuario esté en la tabla admins.
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { ApiError } from './errors.js';

/**
 * Verifica tokens de Supabase Auth.
 * - Proyectos nuevos firman con claves asimétricas → se validan con el JWKS público del proyecto.
 * - Proyectos con "Legacy JWT secret" (HS256) → SUPABASE_JWT_SECRET.
 * @returns {(token: string) => Promise<{ userId: string, email?: string }>}
 */
export function createJwtVerifier({ supabaseUrl, jwtSecret }) {
  const jwks = supabaseUrl ? createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', supabaseUrl)) : null;
  const secret = jwtSecret ? new TextEncoder().encode(jwtSecret) : null;

  return async (token) => {
    const { alg } = decodeProtectedHeader(token);
    const key = alg === 'HS256' ? secret : jwks;
    if (!key) throw new Error(`No hay clave configurada para ${alg}`);
    const { payload } = await jwtVerify(token, key, { audience: 'authenticated' });
    return { userId: payload.sub, email: payload.email };
  };
}

/** Middleware: exige un dueño autenticado. Deja req.admin = { userId, email }. */
export function requireAdmin({ db, verifyToken }) {
  return async (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token || !verifyToken) return next(new ApiError(401, 'UNAUTHENTICATED', 'Tenés que iniciar sesión.'));

    let user;
    try {
      user = await verifyToken(token);
    } catch {
      return next(new ApiError(401, 'UNAUTHENTICATED', 'La sesión venció. Volvé a entrar.'));
    }
    const { rows } = await db.query('select 1 from admins where user_id = $1', [user.userId]);
    if (rows.length === 0) return next(new ApiError(403, 'NOT_ADMIN', 'Este usuario no tiene permiso para el panel.'));
    req.admin = user;
    return next();
  };
}
