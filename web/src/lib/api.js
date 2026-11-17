const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

async function request(method, path, body, token) {
  let res;
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No hay conexión. Revisá tu internet y probá de nuevo.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'UNKNOWN', e.message ?? 'Algo falló. Probá de nuevo.', e.fields);
  }
  return data;
}

export const api = {
  shop: () => request('GET', '/api/shop'),
  availability: ({ serviceId, barberId, date }) => {
    const q = new URLSearchParams({ serviceId, date });
    if (barberId) q.set('barberId', barberId);
    return request('GET', `/api/availability?${q}`);
  },
  book: (body) => request('POST', '/api/appointments', body),
  appointment: (token) => request('GET', `/api/appointments/by-token/${encodeURIComponent(token)}`),
  cancel: (token) => request('POST', `/api/appointments/by-token/${encodeURIComponent(token)}/cancel`),
};

/** Endpoints del panel del dueño (requieren el token de la sesión). */
export function adminApi(token) {
  return {
    me: () => request('GET', '/api/admin/me', null, token),
    agenda: (date) => request('GET', `/api/admin/agenda?date=${date}`, null, token),
    availability: ({ serviceId, barberId, date }) =>
      request('GET', `/api/admin/availability?${new URLSearchParams({ serviceId, barberId, date })}`, null, token),
    appointment: (id) => request('GET', `/api/admin/appointments/${id}`, null, token),
    setStatus: (id, status) => request('PATCH', `/api/admin/appointments/${id}`, { status }, token),
    createManual: (body) => request('POST', '/api/admin/appointments', body, token),
    notifications: (filter = 'all') => request('GET', `/api/admin/notifications?filter=${filter}`, null, token),
    retryNotification: (id) => request('POST', `/api/admin/notifications/${id}/retry`, null, token),
    services: () => request('GET', '/api/admin/services', null, token),
    saveService: (id, body) => (id
      ? request('PATCH', `/api/admin/services/${id}`, body, token)
      : request('POST', '/api/admin/services', body, token)),
    reorderServices: (ids) => request('POST', '/api/admin/services/reorder', { ids }, token),
    barbers: () => request('GET', '/api/admin/barbers', null, token),
    saveBarber: (id, body) => (id
      ? request('PATCH', `/api/admin/barbers/${id}`, body, token)
      : request('POST', '/api/admin/barbers', body, token)),
    reorderBarbers: (ids) => request('POST', '/api/admin/barbers/reorder', { ids }, token),
    timeOff: () => request('GET', '/api/admin/time-off', null, token),
    createTimeOff: (body) => request('POST', '/api/admin/time-off', body, token),
    deleteTimeOff: (id) => request('DELETE', `/api/admin/time-off/${id}`, null, token),
    settings: () => request('GET', '/api/admin/settings', null, token),
    saveSettings: (body) => request('PATCH', '/api/admin/settings', body, token),
  };
}

/** Solo en desarrollo sin Supabase (npm run dev:api:mem). */
export const devLogin = (email, password) => request('POST', '/api/dev/login', { email, password });
