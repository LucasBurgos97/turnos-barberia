// Sesión del dueño. Con VITE_SUPABASE_URL usa Supabase Auth; sin eso (desarrollo con
// `npm run dev:api:mem`) usa el login de prueba de la API en memoria.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { adminApi, devLogin } from '../lib/api.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
export const AUTH_MODE = supabase ? 'supabase' : 'dev';

const DEV_KEY = 'turnos:dev-session';
const readDev = () => { try { return JSON.parse(sessionStorage.getItem(DEV_KEY)); } catch { return null; } };
const writeDev = (v) => { try { v ? sessionStorage.setItem(DEV_KEY, JSON.stringify(v)) : sessionStorage.removeItem(DEV_KEY); } catch { /* */ } };

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState({ status: 'loading', token: null, email: null });

  useEffect(() => {
    if (!supabase) {
      const s = readDev();
      setSession(s ? { status: 'in', ...s } : { status: 'out', token: null, email: null });
      return undefined;
    }
    const apply = (s) => setSession(s
      ? { status: 'in', token: s.access_token, email: s.user?.email ?? null }
      : { status: 'out', token: null, email: null });
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => apply(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email, password) => {
    if (supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos.' : error.message);
      // Verifica que sea admin antes de dejarlo entrar
      await adminApi(data.session.access_token).me().catch(async (err) => {
        await supabase.auth.signOut();
        throw err;
      });
      return;
    }
    const r = await devLogin(email, password);
    const s = { token: r.accessToken, email: r.email };
    writeDev(s);
    setSession({ status: 'in', ...s });
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    writeDev(null);
    setSession({ status: 'out', token: null, email: null });
  }, []);

  const value = useMemo(() => ({
    ...session,
    signIn,
    signOut,
    api: session.token ? adminApi(session.token) : null,
  }), [session, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
