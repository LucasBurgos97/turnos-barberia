import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useBarber, useShop, useService } from '../lib/shop.jsx';
import { api } from '../lib/api.js';
import { duration, price, shortDate, TZ } from '../lib/format.js';
import { FlowBar, Notice, SkeletonRows } from '../components/ui.jsx';
import NotFound from './NotFound.jsx';

const SAVED_KEY = 'turnos:cliente';

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY)) ?? {}; } catch { return {}; }
}
function save(v) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(v)); } catch { /* modo privado */ }
}

const localParts = (iso) => {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  const time = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return { date, time };
};

/** C4 — Tus datos: nombre y celular, y confirmar. */
export default function Details() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { status } = useShop();
  const service = useService(params.get('servicio'));
  const barberParam = params.get('barbero') ?? 'any';
  const barber = useBarber(barberParam);
  const startsAt = params.get('inicio');

  const [form, setForm] = useState(() => ({ name: '', phone: '', ...loadSaved() }));
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [sending, setSending] = useState(false);

  if (status === 'loading') return <><FlowBar /><main className="page"><div style={{ height: 32 }} /><SkeletonRows count={3} /></main></>;
  if (!service || !startsAt || Number.isNaN(Date.parse(startsAt))) return <NotFound />;

  const { date, time } = localParts(startsAt);
  const multi = service.barberIds.length > 1;
  const slotUrl = `/reservar/horario?${new URLSearchParams({ servicio: service.id, barbero: barberParam, dia: date })}`;

  const validate = () => {
    const e = {};
    if (form.name.trim().length < 2) e.name = 'Escribí tu nombre.';
    if (form.phone.replace(/\D/g, '').length < 7) e.phone = 'Escribí tu celular con característica, ej. 387 412 3456.';
    return e;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    setFailure(null);
    if (Object.keys(e).length) return;

    setSending(true);
    try {
      const res = await api.book({
        serviceId: service.id,
        barberId: barberParam === 'any' ? null : barberParam,
        startsAt,
        name: form.name.trim(),
        phone: form.phone.trim(),
      });
      save({ name: form.name.trim(), phone: form.phone.trim() });
      navigate(`/turno/${res.token}`, { replace: true, state: { warnings: res.warnings } });
    } catch (err) {
      if (err.code === 'INVALID_PHONE') setErrors({ phone: err.message });
      else if (err.code === 'VALIDATION_ERROR' && err.fields?.some((f) => f.path === 'name')) setErrors({ name: 'Escribí tu nombre.' });
      else setFailure(err);
      setSending(false);
    }
  };

  const slotGone = failure && ['SLOT_TAKEN', 'SLOT_UNAVAILABLE', 'OUT_OF_WINDOW'].includes(failure.code);

  return (
    <>
      <FlowBar backTo={slotUrl} step={`Paso ${multi ? 3 : 2} de ${multi ? 3 : 2}`} />
      <main className="page">
        <h1 className="page-title">Tus datos</h1>
        <p className="choice">
          <strong>{shortDate(date)}, {time}</strong><span className="choice__dot">·</span>
          <span>{service.name}</span><span className="choice__dot">·</span>
          <span>{barber ? barber.name : 'cualquier barbero'}</span><span className="choice__dot">·</span>
          <span>{duration(service.durationMin)}</span><span className="choice__dot">·</span>
          <span>{price(service.priceArs)}</span>
        </p>

        {failure && (
          <Notice
            tone="error"
            title={slotGone ? 'Ese horario ya no está' : 'No se pudo reservar'}
            action={slotGone && <Link className="btn btn--secondary" to={slotUrl}>Elegir otro horario</Link>}
          >
            {failure.message}
          </Notice>
        )}

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label className="field__label" htmlFor="name">Nombre</label>
            <input
              id="name" className="input" autoComplete="given-name" autoCapitalize="words"
              value={form.name} maxLength={60}
              aria-invalid={!!errors.name} aria-describedby={errors.name ? 'name-error' : undefined}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            {errors.name && <span className="field__error" id="name-error">{errors.name}</span>}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="phone">Celular</label>
            <input
              id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel"
              placeholder="387 412 3456" value={form.phone} maxLength={30}
              aria-invalid={!!errors.phone} aria-describedby={errors.phone ? 'phone-error' : 'phone-hint'}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            {errors.phone
              ? <span className="field__error" id="phone-error">{errors.phone}</span>
              : <span className="field__hint" id="phone-hint">Te mandamos la confirmación y el recordatorio por WhatsApp.</span>}
          </div>

          <div className="sticky-cta">
            <button type="submit" className="btn btn--primary btn--block" disabled={sending}>
              {sending ? 'Reservando…' : `Confirmar turno · ${time}`}
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
