import { useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useShop } from '../lib/shop.jsx';
import { duration, price, todayStr } from '../lib/format.js';
import { Notice } from '../components/ui.jsx';
import Panel from './Panel.jsx';

/** A4 — Turno manual: para quien llama o llega sin turno. */
export default function NewAppointmentPanel({ date: initialDate, barbers, onClose, onCreated }) {
  const { api } = useAuth();
  const { data: shop } = useShop();
  const services = shop?.services.filter((s) => s.barberIds.length) ?? [];

  const [form, setForm] = useState(() => ({
    serviceId: services[0]?.id ?? '',
    barberId: '',
    date: initialDate < todayStr() ? todayStr() : initialDate,
    startsAt: '',
    name: '',
    phone: '',
  }));
  const [slots, setSlots] = useState({ status: 'idle', list: [], reason: null });
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [sending, setSending] = useState(false);

  const service = services.find((s) => s.id === form.serviceId);
  const barberOptions = barbers.filter((b) => service?.barberIds.includes(b.id));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Barbero por defecto: el primero que hace el servicio
  useEffect(() => {
    if (service && !service.barberIds.includes(form.barberId)) set({ barberId: barberOptions[0]?.id ?? '', startsAt: '' });
  }, [form.serviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!form.serviceId || !form.barberId || !form.date) return undefined;
    let alive = true;
    setSlots({ status: 'loading', list: [], reason: null });
    api.availability({ serviceId: form.serviceId, barberId: form.barberId, date: form.date })
      .then((r) => {
        if (!alive) return;
        setSlots({ status: 'ready', list: r.slots, reason: r.reason });
        // Por defecto, el primer horario que no pasó hace más de media hora (para quien llega sin turno)
        const soon = new Date(Date.now() - 30 * 60000).toISOString();
        const suggested = r.slots.find((s) => s.startsAt >= soon) ?? r.slots[0];
        setForm((f) => (r.slots.some((s) => s.startsAt === f.startsAt) ? f : { ...f, startsAt: suggested?.startsAt ?? '' }));
      })
      .catch((error) => alive && setSlots({ status: 'error', list: [], reason: error.message }));
    return () => { alive = false; };
  }, [api, form.serviceId, form.barberId, form.date]);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.startsAt) errs.startsAt = 'Elegí un horario libre.';
    if (form.name.trim().length < 2) errs.name = 'Escribí el nombre.';
    setErrors(errs);
    setFailure(null);
    if (Object.keys(errs).length) return;
    setSending(true);
    try {
      const appt = await api.createManual({
        serviceId: form.serviceId, barberId: form.barberId, startsAt: form.startsAt,
        name: form.name.trim(), phone: form.phone.trim() || null,
      });
      onCreated(appt);
    } catch (err) {
      if (err.code === 'INVALID_PHONE') setErrors({ phone: err.message });
      else setFailure(err);
      setSending(false);
    }
  };

  const reasonText = { closed: 'Ese día no trabaja.', full: 'No le quedan horarios libres.', out_of_window: 'Fecha fuera de rango.' };

  return (
    <Panel title="Nuevo turno" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="m-service">Servicio</label>
          <select id="m-service" className="input" value={form.serviceId} onChange={(e) => set({ serviceId: e.target.value })}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name} · {duration(s.durationMin)} · {price(s.priceArs)}</option>
            ))}
          </select>
        </div>

        <div className="field-row">
          <div className="field">
            <label className="field__label" htmlFor="m-barber">Barbero</label>
            <select id="m-barber" className="input" value={form.barberId} onChange={(e) => set({ barberId: e.target.value })}>
              {barberOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="m-date">Día</label>
            <input id="m-date" type="date" className="input" min={todayStr()} value={form.date}
              onChange={(e) => e.target.value && set({ date: e.target.value })} />
          </div>
        </div>

        <div className="field">
          <span className="field__label" id="m-time-label">Hora</span>
          {slots.status === 'loading' && <div className="skeleton" style={{ height: 48 }} />}
          {slots.status === 'error' && <span className="field__error">{slots.reason}</span>}
          {slots.status === 'ready' && slots.list.length === 0 && (
            <span className="field__hint">{reasonText[slots.reason] ?? 'Sin horarios libres.'}</span>
          )}
          {slots.status === 'ready' && slots.list.length > 0 && (
            <div className="slots slots--compact" role="radiogroup" aria-labelledby="m-time-label">
              {slots.list.map((s) => (
                <button key={s.startsAt} type="button" role="radio" aria-checked={form.startsAt === s.startsAt}
                  className="slot" onClick={() => set({ startsAt: s.startsAt })}>
                  {s.time}
                </button>
              ))}
            </div>
          )}
          {errors.startsAt && <span className="field__error">{errors.startsAt}</span>}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="m-name">Nombre</label>
          <input id="m-name" className="input" value={form.name} maxLength={60} autoComplete="off"
            aria-invalid={!!errors.name} onChange={(e) => set({ name: e.target.value })} />
          {errors.name && <span className="field__error">{errors.name}</span>}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="m-phone">Celular <span className="small">(opcional)</span></label>
          <input id="m-phone" className="input" type="tel" inputMode="tel" placeholder="387 412 3456" value={form.phone}
            maxLength={30} autoComplete="off" aria-invalid={!!errors.phone} onChange={(e) => set({ phone: e.target.value })} />
          {errors.phone
            ? <span className="field__error">{errors.phone}</span>
            : <span className="field__hint">Con celular, le llegan la confirmación y el recordatorio.</span>}
        </div>

        {failure && <Notice tone="error" title="No se pudo cargar">{failure.message}</Notice>}

        <button type="submit" className="btn btn--primary btn--block" disabled={sending}>
          {sending ? 'Guardando…' : 'Guardar turno'}
        </button>
      </form>
    </Panel>
  );
}
