import { useCallback, useEffect, useState } from 'react';
import { Check, MessageCircle, Phone, RotateCcw, X } from 'lucide-react';
import { useAuth } from './auth.jsx';
import { useShop } from '../lib/shop.jsx';
import { KIND_LABEL, manualText, NOTIF_LABEL, waLink } from './notifLabels.js';
import { price, shortDate, turnoNumber, TZ } from '../lib/format.js';
import { Notice } from '../components/ui.jsx';
import Panel from './Panel.jsx';

const STATUS_LABEL = {
  booked: 'Reservado',
  completed: 'Atendido',
  no_show: 'No vino',
  cancelled_by_customer: 'Canceló el cliente',
  cancelled_by_shop: 'Cancelado por el local',
};
const fmtDateTime = (iso) => new Intl.DateTimeFormat('es-AR', {
  timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(iso)).replace('.', '');

/** A3 — Detalle del turno en panel lateral. */
export default function AppointmentPanel({ id, onClose, onChanged }) {
  const { api } = useAuth();
  const { data: shop } = useShop();
  const [state, setState] = useState({ status: 'loading', a: null, error: null });
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const reload = useCallback(() => api.appointment(id).then((a) => setState({ status: 'ready', a, error: null })), [api, id]);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', a: null, error: null });
    setConfirmCancel(false);
    setActionError(null);
    api.appointment(id)
      .then((a) => alive && setState({ status: 'ready', a, error: null }))
      .catch((error) => alive && setState({ status: 'error', a: null, error }));
    return () => { alive = false; };
  }, [api, id]);

  const retry = async (notificationId) => {
    setBusy(`retry:${notificationId}`);
    setActionError(null);
    try {
      await api.retryNotification(notificationId);
      await new Promise((r) => setTimeout(r, 800)); // el envío sale en segundo plano
      await reload();
      onChanged();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (status) => {
    setBusy(status);
    setActionError(null);
    try {
      const a = await api.setStatus(id, status);
      setState({ status: 'ready', a, error: null });
      setConfirmCancel(false);
      onChanged();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  const a = state.a;
  return (
    <Panel title={a ? `Turno ${turnoNumber(a.number)}` : 'Turno'} onClose={onClose}>
      {state.status === 'loading' && <div className="skeleton" style={{ height: 280 }} aria-busy="true" />}
      {state.status === 'error' && <Notice tone="error" title="No pudimos cargar el turno">{state.error.message}</Notice>}

      {a && (
        <>
          <div className="detail__when">
            <span className="detail__time">{a.time}<span className="detail__end"> → {a.endTime}</span></span>
            <span className={`stamp stamp--${a.status === 'booked' ? 'ok' : a.status === 'completed' ? 'done' : 'void'}`}>
              {STATUS_LABEL[a.status]}
            </span>
          </div>

          <dl className="etiqueta__rows detail__rows">
            <Row k="Día" v={shortDate(a.date)} />
            <Row k="Servicio" v={a.service.name} />
            <Row k="Barbero" v={a.barberName} />
            <Row k="Valor" v={price(a.service.priceArs)} />
            <Row k="Origen" v={a.source === 'online' ? `Online · ${fmtDateTime(a.createdAt)}` : 'Cargado a mano'} />
          </dl>

          <section className="detail__section">
            <h3 className="label">Cliente</h3>
            <p className="detail__customer">{a.customer.name}</p>
            {a.customer.phone ? (
              <>
                <p className="small" style={{ margin: '2px 0 10px' }}>{a.customer.phone}</p>
                <div className="actions" style={{ marginTop: 0 }}>
                  <a className="btn btn--secondary btn--sm" href={waLink(a.customer.phone)} target="_blank" rel="noreferrer">
                    <MessageCircle size={16} aria-hidden="true" /> WhatsApp
                  </a>
                  <a className="btn btn--secondary btn--sm" href={`tel:${a.customer.phone}`}>
                    <Phone size={16} aria-hidden="true" /> Llamar
                  </a>
                </div>
              </>
            ) : <p className="small">Sin celular cargado.</p>}

            <p className="small" style={{ marginTop: 12 }}>
              {a.customer.history.total === 0 ? 'Primera vez.' : (
                <>
                  {a.customer.history.completed} {a.customer.history.completed === 1 ? 'visita' : 'visitas'} antes
                  {a.customer.history.lastVisit && ` · última ${shortDate(a.customer.history.lastVisit)}`}
                  {a.customer.history.cancelled > 0 && ` · ${a.customer.history.cancelled} cancelados`}
                </>
              )}
            </p>
            {a.customer.noShowCount > 0 && (
              <p className="t-warn small" style={{ marginTop: 4 }}>
                Faltó {a.customer.noShowCount} {a.customer.noShowCount === 1 ? 'vez' : 'veces'} sin avisar.
              </p>
            )}
          </section>

          <section className="detail__section">
            <h3 className="label">WhatsApp</h3>
            {a.notifications.length === 0 ? <p className="small">Sin mensajes.</p> : (
              <ul className="msgs">
                {a.notifications.map((n) => (
                  <li key={n.kind} className={`msg msg--${n.status}`}>
                    <span>{KIND_LABEL[n.kind]}</span>
                    <span className="msg__status">
                      {NOTIF_LABEL[n.status]}
                      {n.status === 'scheduled' && ` · ${fmtDateTime(n.scheduledFor)}`}
                    </span>
                    {n.status === 'failed' && (
                      <span className="msg__fail">
                        {n.error && <span className="small msg__error">{n.error}</span>}
                        <span className="msg__actions">
                          <button type="button" className="link-btn" onClick={() => retry(n.id)} disabled={!!busy}>
                            {busy === `retry:${n.id}` ? 'Reintentando…' : 'Reintentar'}
                          </button>
                          {a.customer.phone && (
                            <a className="link-btn" target="_blank" rel="noreferrer" href={waLink(a.customer.phone, manualText(n.kind, {
                              firstName: a.customer.name.split(' ')[0], shopName: shop?.shop.name ?? '',
                              dateLabel: shortDate(a.date), time: a.time,
                            }))}>
                              Mandar a mano
                            </a>
                          )}
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {actionError && <Notice tone="error" title="No se pudo guardar">{actionError.message}</Notice>}

          {a.status === 'booked' && (
            <div className="actions">
              <button type="button" className="btn btn--primary" onClick={() => setStatus('completed')} disabled={!!busy}>
                <Check size={18} aria-hidden="true" /> {busy === 'completed' ? 'Guardando…' : 'Asistió'}
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => setStatus('no_show')} disabled={!!busy}>
                <X size={18} aria-hidden="true" /> {busy === 'no_show' ? 'Guardando…' : 'No vino'}
              </button>
            </div>
          )}
          {(a.status === 'completed' || a.status === 'no_show') && (
            <button type="button" className="btn btn--secondary btn--block" style={{ marginTop: 16 }}
              onClick={() => setStatus('booked')} disabled={!!busy}>
              <RotateCcw size={18} aria-hidden="true" /> Deshacer “{STATUS_LABEL[a.status]}”
            </button>
          )}

          {a.status === 'booked' && (
            <section className="cancel-zone" aria-label="Cancelar turno">
              {!confirmCancel ? (
                <button type="button" className="btn btn--danger btn--block" onClick={() => setConfirmCancel(true)}>
                  Cancelar turno
                </button>
              ) : (
                <>
                  <p style={{ margin: '0 0 6px', fontWeight: 600 }}>¿Cancelar el turno de {a.customer.name.split(' ')[0]} a las {a.time}?</p>
                  <p className="small" style={{ margin: '0 0 12px' }}>
                    {a.customer.phone ? 'Le avisamos por WhatsApp.' : 'No tiene celular: avisale vos.'}
                  </p>
                  <div className="actions" style={{ marginTop: 0 }}>
                    <button type="button" className="btn btn--secondary" onClick={() => setConfirmCancel(false)} disabled={!!busy}>
                      Mantener
                    </button>
                    <button type="button" className="btn btn--danger" onClick={() => setStatus('cancelled_by_shop')} disabled={!!busy}>
                      {busy === 'cancelled_by_shop' ? 'Cancelando…' : 'Sí, cancelar'}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}
    </Panel>
  );
}

function Row({ k, v }) {
  return (
    <div className="etiqueta__row">
      <dt className="label">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
