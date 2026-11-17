import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';

/** Carga un recurso del panel con estados loading / ready / error. 401/403 cierran la sesión. */
export function useLoad(fetcher) {
  const { api, signOut } = useAuth();
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  const load = useCallback(async () => {
    try {
      const data = await fetcher(api);
      setState({ status: 'ready', data, error: null });
      return data;
    } catch (error) {
      if (error.status === 401 || error.status === 403) { signOut(); return null; }
      setState((s) => ({ status: s.data ? 'ready' : 'error', data: s.data, error }));
      return null;
    }
  }, [api, signOut]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (data) => setState((s) => ({ ...s, data })) };
}

/** Errores de validación de la API → { campo: mensaje } */
export function fieldErrors(err) {
  if (err?.code !== 'VALIDATION_ERROR' || !err.fields) return {};
  return Object.fromEntries(err.fields.map((f) => [f.path.split('.')[0], f.message]));
}
