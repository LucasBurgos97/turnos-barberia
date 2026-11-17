import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ban, Check, ChevronLeft, ChevronRight, Clock, MessageCircle, Phone, Plus, X } from 'lucide-react';
import { useAuth } from './auth.jsx';
import { addDays, longDate, price, todayStr, TZ } from '../lib/format.js';
import { Notice } from '../components/ui.jsx';
import AppointmentPanel from './AppointmentPanel.jsx';
import NewAppointmentPanel from './NewAppointmentPanel.jsx';

const REFRESH_MS = 60_000;
const isCancelled = (s) => s === 'cancelled_by_customer' || s === 'cancelled_by_shop';

const clockTime = (d) => new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

/** A2 — Agenda del día: columnas por barbero, hora grande, estado de cada turno. */
export default function Agenda() {
  const { api, signOut } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = todayStr();
  const date = params.get('dia') ?? today;

  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [marks, setMarks] = useState({}); // id → 'new' | 'cancelled'
  const [updatedAt, setUpdatedAt] = useState(null);
  const [now, setNow] = useState(() => new Date());
  // { type: 'detail', id } | { type: 'new' }. ?turno=<id> abre el detalle (link desde Recordatorios)
  const [panel, setPanel] = useState(() => (params.get('turno') ? { type: 'detail', id: params.get('turno') } : null));
  const prev = useRef({ date: null, byId: new Map() });

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setState((s) => ({ ...s, status: s.data && s.data.date === date ? 'refreshing' : 'loading' }));
    try {
      const data = await api.agenda(date);
      // Marcar lo que cambió desde la última carga del mismo día
      if (prev.current.date === date) {
        const found = {};
        for (const a of data.appointments) {
          const before = prev.current.byId.get(a.id);
          if (!before && a.source === 'online') found[a.id] = 'new';
          else if (before && !isCancelled(before) && isCancelled(a.status)) found[a.id] = 'cancelled';
        }
        if (Object.keys(found).length) setMarks((m) => ({ ...m, ...found }));
      } else {
        setMarks({});
      }
      prev.current = { date, byId: new Map(data.appointments.map((a) => [a.id, a.status])) };
      setState({ status: 'ready', data, error: null });
      setUpdatedAt(new Date());
    } catch (error) {
      if (error.status === 401 || error.status === 403) { signOut(); return; }
      setState((s) => ({ ...s, status: s.data ? 'ready' : 'error', error }));
    }
  }, [api, date, signOut]);

  useEffect(() => { load(); }, [load]);

  // Refresco automático cada minuto y al volver a la pestaña
  useEffect(() => {
    const tick = () => { setNow(new Date()); if (document.visibilityState === 'visible') load({ quiet: true }); };
    const id = setInterval(tick, REFRESH_MS);
    const onVis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const setDate = (d) => setParams(d === today ? {} : { dia: d });
  const open = (id) => {
    setPanel({ type: 'detail', id });
    setMarks((m) => { const { [id]: _, ...rest } = m; return rest; });
  };
  const onChanged = () => load({ quiet: true });

  const data = state.data;
  const nowIso = now.toISOString();

  return (
    <div className={`agenda${panel ? ' agenda--with-panel' : ''}`}>
      <div className="agenda__body">
        <header className="agenda__head">
          <div className="agenda__title-row">
            <h1 className="agenda__title">
              {date === today ? 'Hoy' : date === addDays(today, 1) ? 'Mañana' : 'Agenda'}
              <span className="agenda__date">{longDate(date)}</span>
            </h1>
            <button type="button" className={`btn ${panel ? 'btn--secondary' : 'btn--primary'}`} onClick={() => setPanel({ type: 'new' })}>
              <Plus size={18} aria-hidden="true" /> Nuevo turno
            </button>
          </div>

          <div className="agenda__nav">
            <button type="button" className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Día anterior">
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setDate(today)} disabled={date === today}>
              Hoy
            </button>
            <button type="button" className="icon-btn" onClick={() => setDate(addDays(date, 1))} aria-label="Día siguiente">
              <ChevronRight size={20} aria-hidden="true" />
            </button>
            <label className="sr-only" htmlFor="agenda-date">Ir a fecha</label>
            <input id="agenda-date" type="date" className="input input--sm" value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)} />
            {updatedAt && (
              <span className="small agenda__updated" aria-live="polite">
                {state.status === 'refreshing' ? 'Actualizando…' : `Actualizado ${clockTime(updatedAt)}`}
              </span>
            )}
          </div>

          {data && data.date === date && <Summary data={data} />}
        </header>

        {state.status === 'loading' && <div className="skeleton" style={{ height: 320 }} aria-busy="true" />}
        {state.status === 'error' && (
          <Notice tone="error" title="No pudimos cargar la agenda"
            action={<button type="button" className="btn btn--secondary" onClick={() => load()}>Reintentar</button>}>
            {state.error?.message}
          </Notice>
        )}

        {data && data.date === date && state.status !== 'loading' && (
          data.barbers.every((b) => b.closed) && data.appointments.length === 0 ? (
            <Notice title="El local no atiende este día" />
          ) : (
            <div className="columns" style={{ '--cols': data.barbers.length }}>
              {data.barbers.map((b) => {
                const list = data.appointments.filter((a) => a.barberId === b.id);
                return (
                  <section key={b.id} className="column" aria-label={b.name}>
                    <header className="column__head">
                      <h2 className="column__name">{b.name}</h2>
                      <span className="small">
                        {b.closed ? 'No trabaja este día' : b.ranges.map((r) => `${r.start}–${r.end}`).join(' · ')}
                      </span>
                    </header>
                    {list.length === 0 ? (
                      <p className="column__empty">{b.closed ? '—' : 'Sin turnos todavía.'}</p>
                    ) : (
                      <ol className="column__list">
                        {list.map((a) => (
                          <li key={a.id}>
                            <TurnoRow a={a} nowIso={nowIso} mark={marks[a.id]}
                              selected={panel?.type === 'detail' && panel.id === a.id} onOpen={() => open(a.id)} />
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                );
              })}
            </div>
          )
        )}
      </div>

      {panel?.type === 'detail' && (
        <AppointmentPanel id={panel.id} onClose={() => setPanel(null)} onChanged={onChanged} />
      )}
      {panel?.type === 'new' && (
        <NewAppointmentPanel
          date={date}
          barbers={data?.barbers ?? []}
          onClose={() => setPanel(null)}
          onCreated={(appt) => { onChanged(); setPanel({ type: 'detail', id: appt.id }); if (appt.date !== date) setDate(appt.date); }}
        />
      )}
    </div>
  );
}

function Summary({ data }) {
  const { total, done, noShow, cancelled, next } = data.summary;
  return (
    <p className="agenda__summary">
      <strong>{total} {total === 1 ? 'turno' : 'turnos'}</strong>
      {done > 0 && <span>{done} {done === 1 ? 'atendido' : 'atendidos'}</span>}
      {noShow > 0 && <span className="t-danger">{noShow} no {noShow === 1 ? 'vino' : 'vinieron'}</span>}
      {cancelled > 0 && <span>{cancelled} {cancelled === 1 ? 'cancelado' : 'cancelados'}</span>}
      {next && data.date === data.today && (
        <span className="agenda__next">Próximo <strong>{next.time}</strong> {next.customer.name.split(' ')[0]} con {next.barberName.split(' ')[0]}</span>
      )}
    </p>
  );
}

const NOTIF_ICON = { sent: Check, delivered: Check, read: Check, failed: X };

function TurnoRow({ a, nowIso, mark, selected, onOpen }) {
  const cancelled = isCancelled(a.status);
  const inProgress = a.status === 'booked' && a.startsAt <= nowIso && nowIso < a.endsAt;
  const pastUnmarked = a.status === 'booked' && a.endsAt <= nowIso;
  const reminder = a.notifications?.reminder;
  const RIcon = NOTIF_ICON[reminder];

  const cls = ['turno',
    cancelled && 'turno--cancelled', inProgress && 'turno--now', a.status === 'completed' && 'turno--done',
    a.status === 'no_show' && 'turno--noshow', selected && 'turno--selected'].filter(Boolean).join(' ');

  return (
    <button type="button" className={cls} onClick={onOpen} aria-current={selected || undefined}>
      <span className="turno__time">{a.time}</span>
      <span className="turno__body">
        <span className="turno__name">
          {a.customer.name}
          {mark === 'new' && <span className="tag tag--new">Nuevo</span>}
          {mark === 'cancelled' && <span className="tag tag--danger">Recién cancelado</span>}
        </span>
        <span className="turno__meta">
          {a.service.name} · {price(a.service.priceArs)} · hasta {a.endTime}
        </span>
        <span className="turno__chips">
          {inProgress && <span className="chip chip--now"><Clock size={13} aria-hidden="true" /> En curso</span>}
          {cancelled && <span className="chip chip--danger"><Ban size={13} aria-hidden="true" /> {a.status === 'cancelled_by_shop' ? 'Cancelado por el local' : 'Canceló el cliente'}</span>}
          {a.status === 'completed' && <span className="chip chip--ok"><Check size={13} aria-hidden="true" /> Atendido</span>}
          {a.status === 'no_show' && <span className="chip chip--danger"><X size={13} aria-hidden="true" /> No vino</span>}
          {pastUnmarked && <span className="chip chip--warn">¿Vino?</span>}
          {a.source === 'manual' && <span className="chip"><Phone size={13} aria-hidden="true" /> Cargado a mano</span>}
          {!cancelled && a.status === 'booked' && reminder && reminder !== 'skipped' && (
            <span className={`chip${reminder === 'failed' ? ' chip--danger' : ''}`}>
              {RIcon ? <RIcon size={13} aria-hidden="true" /> : <MessageCircle size={13} aria-hidden="true" />}
              {reminder === 'failed' ? 'Recordatorio falló' : reminder === 'scheduled' ? 'Recordatorio programado' : 'Recordado'}
            </span>
          )}
          {a.customer.noShowCount > 0 && !cancelled && a.status === 'booked' && (
            <span className="chip chip--warn">{a.customer.noShowCount} {a.customer.noShowCount === 1 ? 'falta' : 'faltas'}</span>
          )}
        </span>
      </span>
    </button>
  );
}
