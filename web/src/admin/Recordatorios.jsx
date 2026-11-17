import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, RotateCcw } from 'lucide-react';
import { useAuth } from './auth.jsx';
import { useShop } from '../lib/shop.jsx';
import { shortDate, turnoNumber, TZ } from '../lib/format.js';
import { Notice } from '../components/ui.jsx';
import { KIND_LABEL, manualText, NOTIF_LABEL, NOTIF_TONE, waLink } from './notifLabels.js';

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'pending', label: 'En cola' },
  { id: 'sent', label: 'Enviados' },
  { id: 'failed', label: 'Fallidos' },
];

const when = (iso) => new Intl.DateTimeFormat('es-AR', {
  timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(iso)).replace('.', '');

/** A7 — Log de mensajes de WhatsApp con reintento. */
export default function Recordatorios() {
  const { api, signOut } = useAuth();
  const { data: shop } = useShop();
  const [filter, setFilter] = useState('all');
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [retrying, setRetrying] = useState(null);
  const [retryError, setRetryError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.notifications(filter);
      setState({ status: 'ready', data, error: null });
    } catch (error) {
      if (error.status === 401 || error.status === 403) { signOut(); return; }
      setState((s) => ({ ...s, status: s.data ? 'ready' : 'error', error }));
    }
  }, [api, filter, signOut]);

  useEffect(() => {
    setState((s) => ({ ...s, status: 'loading' }));
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const retry = async (id) => {
    setRetrying(id);
    setRetryError(null);
    try {
      await api.retryNotification(id);
      await new Promise((r) => setTimeout(r, 800)); // el envío sale en segundo plano
      await load();
    } catch (err) {
      setRetryError(err);
    } finally {
      setRetrying(null);
    }
  };

  const data = state.data;

  return (
    <div className="page-admin">
      <header className="agenda__head">
        <h1 className="agenda__title">Recordatorios</h1>
        <p className="lead" style={{ marginTop: 6 }}>Confirmaciones, recordatorios y avisos de cancelación por WhatsApp.</p>

        <div className="tabs" role="tablist" aria-label="Filtrar mensajes">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className="tab" onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id === 'failed' && data?.counts.failed > 0 && <span className="tab__count tab__count--danger">{data.counts.failed}</span>}
              {f.id === 'pending' && data?.counts.pending > 0 && <span className="tab__count">{data.counts.pending}</span>}
            </button>
          ))}
        </div>
      </header>

      {data && !data.whatsappEnabled && (
        <Notice tone="warn" title="WhatsApp todavía no está conectado">
          Los mensajes quedan en cola. Mientras Meta aprueba las plantillas, mandalos a mano con el botón WhatsApp de cada fila.
        </Notice>
      )}
      {retryError && <Notice tone="error" title="No se pudo reintentar">{retryError.message}</Notice>}

      {state.status === 'loading' && !data && <div className="skeleton" style={{ height: 240 }} aria-busy="true" />}
      {state.status === 'error' && (
        <Notice tone="error" title="No pudimos cargar los mensajes"
          action={<button type="button" className="btn btn--secondary" onClick={load}>Reintentar</button>}>
          {state.error?.message}
        </Notice>
      )}

      {data && data.items.length === 0 && (
        <Notice title={filter === 'failed' ? 'No hay mensajes fallidos' : 'Todavía no hay mensajes'}>
          {filter === 'failed' ? 'Todo salió bien.' : 'Cuando alguien reserve, acá vas a ver cada mensaje y si le llegó.'}
        </Notice>
      )}

      {data && data.items.length > 0 && (
        <table className="log">
          <thead>
            <tr>
              <th scope="col">Estado</th>
              <th scope="col">Mensaje</th>
              <th scope="col">Cliente</th>
              <th scope="col">Turno</th>
              <th scope="col">Cuándo</th>
              <th scope="col"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((n) => {
              const pending = n.status === 'scheduled' || n.status === 'sending';
              const text = n.customer.phone && manualText(n.kind, {
                firstName: n.customer.name.split(' ')[0], shopName: shop?.shop.name ?? '',
                dateLabel: shortDate(n.appointment.date), time: n.appointment.time,
              });
              return (
                <tr key={n.id} className={`log__row log__row--${n.status}`}>
                  <td data-label="Estado">
                    <span className={`chip${NOTIF_TONE[n.status] ? ` chip--${NOTIF_TONE[n.status]}` : ''}`}>{NOTIF_LABEL[n.status]}</span>
                  </td>
                  <td data-label="Mensaje">
                    {KIND_LABEL[n.kind]}
                    {n.error && <span className="log__error">{n.error}</span>}
                  </td>
                  <td data-label="Cliente">
                    <span className="log__strong">{n.customer.name}</span>
                    <span className="small">{n.customer.phone ?? 'sin celular'}</span>
                  </td>
                  <td data-label="Turno">
                    <Link to={`/admin?dia=${n.appointment.date}&turno=${n.appointment.id}`}>
                      {turnoNumber(n.appointment.number)}
                    </Link>
                    <span className="small">{shortDate(n.appointment.date)} · {n.appointment.time}</span>
                  </td>
                  <td data-label="Cuándo" className="log__when">
                    {n.sentAt ? when(n.sentAt) : pending ? `sale ${when(n.scheduledFor)}` : when(n.updatedAt)}
                    {n.attempts > 1 && <span className="small">{n.attempts} intentos</span>}
                  </td>
                  <td className="log__actions">
                    {n.status === 'failed' && (
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => retry(n.id)} disabled={retrying === n.id}>
                        <RotateCcw size={16} aria-hidden="true" /> {retrying === n.id ? 'Enviando…' : 'Reintentar'}
                      </button>
                    )}
                    {(n.status === 'failed' || (pending && !data.whatsappEnabled)) && text && (
                      <a className="btn btn--secondary btn--sm" href={waLink(n.customer.phone, text)} target="_blank" rel="noreferrer">
                        <MessageCircle size={16} aria-hidden="true" /> WhatsApp
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
