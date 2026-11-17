import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const ShopContext = createContext(null);

/** Carga una vez los datos del local (nombre, servicios, barberos) para todo el flujo. */
export function ShopProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [slow, setSlow] = useState(false);

  // reload() recarga en silencio (después de guardar ajustes); la primera carga muestra el esqueleto
  const load = useCallback((quiet = false) => {
    if (!quiet) setState({ status: 'loading', data: null, error: null });
    // La API gratis de Render se duerme: el primer pedido puede tardar hasta ~1 minuto
    const timer = setTimeout(() => setSlow(true), 4000);
    return api.shop()
      .then((data) => {
        setState({ status: 'ready', data, error: null });
        document.title = `Turnos · ${data.shop.name}`;
      })
      .catch((error) => { if (!quiet) setState({ status: 'error', data: null, error }); })
      .finally(() => { clearTimeout(timer); setSlow(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <ShopContext.Provider value={{ ...state, slow, reload: () => load(true) }}>
      {children}
    </ShopContext.Provider>
  );
}

export function useShop() {
  return useContext(ShopContext);
}

export function useService(id) {
  const { data } = useShop();
  return data?.services.find((s) => s.id === id) ?? null;
}

export function useBarber(id) {
  const { data } = useShop();
  return data?.barbers.find((b) => b.id === id) ?? null;
}
