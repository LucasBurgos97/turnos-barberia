import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarOff, Plus, Trash2, X } from 'lucide-react';
import { useAuth } from './auth.jsx';
import { useShop } from '../lib/shop.jsx';
import { shortDate, todayStr } from '../lib/format.js';
import { Notice } from '../components/ui.jsx';
import Panel from './Panel.jsx';
import { fieldErrors, useLoad } from './useLoad.js';

// Semana empezando el lunes
const DAYS = [
  { wd: 1, name: 'Lunes', short: 'Lun' }, { wd: 2, name: 'Martes', short: 'Mar' }, { wd: 3, name: 'Miércoles', short: 'Mié' },
  { wd: 4, name: 'Jueves', short: 'Jue' }, { wd: 5, name: 'Viernes', short: 'Vie' }, { wd: 6, name: 'Sábado', short: 'Sáb' },
  { wd: 0, name: 'Domingo', short: 'Dom' },
];

/** "Mar a Vie 09:00–13:00 y 17:00–21:00 · Sáb 09:00–14:00" */
export function hoursSummary(hours) {
  if (!hours.length) return 'Sin horario cargado';
  const key = (wd) => hours.filter((h) => h.weekday === wd).map((h) => `${h.start}–${h.end}`).join(' y ');
  const groups = [];
  for (const d of DAYS) {
    const k = key(d.wd);
    if (!k) continue;
    const last = groups.at(-1);
    if (last && last.k === k && DAYS.indexOf(last.to) === DAYS.indexOf(d) - 1) last.to = d;
    else groups.push({ k, from: d, to: d });
  }
  return groups.map((g) => {
    const span = g.from === g.to ? g.from.short : `${g.from.short} a ${g.to.short}`;
    return `${span} ${g.k}`;
  }).join(' · ');
}

/** A6 — Barberos, horarios y días libres. */
export default function Barberos() {
  const { api } = useAuth();
  const shop = useShop();
  const barbers = useLoad((a) => a.barbers());
  const services = useLoad((a) => a.services());
  const timeOff = useLoad((a) => a.timeOff());
  const [panel, setPanel] = useState(null); // { type: 'barber', barber|null } | { type: 'off' }
  const [deleting, setDeleting] = useState(null);

  const list = barbers.data ?? [];
  const close = () => setPanel(null);

  const removeOff = async (id) => {
    setDeleting(id);
    try {
      await api.deleteTimeOff(id);
      await timeOff.reload();
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className={`settings${panel ? ' settings--with-panel' : ''}`}>
      <div className="page-admin">
        <header className="settings__head">
          <div>
            <h1 className="agenda__title">Barberos</h1>
            <p className="lead" style={{ marginTop: 6 }}>Quién atiende, qué hace y en qué horario.</p>
          </div>
          <button type="button" className={`btn ${panel ? 'btn--secondary' : 'btn--primary'}`}
            onClick={() => setPanel({ type: 'barber', barber: null })}>
            <Plus size={18} aria-hidden="true" /> Nuevo barbero
          </button>
        </header>

        {barbers.status === 'loading' && <div className="skeleton" style={{ height: 180 }} />}
        {barbers.status === 'error' && <Notice tone="error" title="No pudimos cargar los barberos">{barbers.error.message}</Notice>}

        {list.length > 0 && (
          <ul className="ledger ledger--admin">
            {list.map((b) => (
              <li key={b.id} className={b.active ? '' : 'is-inactive'}>
                <button type="button" className="row-btn row-btn--admin row-btn--barber"
                  aria-current={panel?.barber?.id === b.id || undefined}
                  onClick={() => setPanel({ type: 'barber', barber: b })}>
                  {b.photoUrl
                    ? <img className="avatar" src={b.photoUrl} alt="" />
                    : <span className="avatar" aria-hidden="true">{b.name.charAt(0)}</span>}
                  <span>
                    <span className="row-btn__name">
                      {b.name}
                      {!b.active && <span className="chip" style={{ marginLeft: 10 }}>No atiende</span>}
                    </span>
                    <span className={`row-btn__sub${b.hours.length ? '' : ' t-warn'}`}>{hoursSummary(b.hours)}</span>
                    <span className="row-btn__sub">
                      {b.serviceIds.length === 0 ? 'Sin servicios' : `${b.serviceIds.length} ${b.serviceIds.length === 1 ? 'servicio' : 'servicios'}`}
                      {b.upcoming > 0 && ` · ${b.upcoming} turnos próximos`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <section className="settings__section">
          <div className="settings__section-head">
            <div>
              <h2 className="settings__h2">Días libres y feriados</h2>
              <p className="small" style={{ margin: '4px 0 0' }}>En esos días u horarios no se ofrecen turnos.</p>
            </div>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setPanel({ type: 'off' })}>
              <CalendarOff size={16} aria-hidden="true" /> Agregar
            </button>
          </div>

          {timeOff.status === 'ready' && timeOff.data.length === 0 && (
            <p className="small">No hay días libres cargados.</p>
          )}
          {timeOff.data?.length > 0 && (
            <ul className="offs">
              {timeOff.data.map((t) => (
                <li key={t.id} className="off">
                  <span className="off__when">
                    {t.fromDate === t.toDate ? shortDate(t.fromDate) : `${shortDate(t.fromDate)} → ${shortDate(t.toDate)}`}
                    {!t.allDay && <span className="small"> · {t.fromTime}–{t.toTime}</span>}
                  </span>
                  <span className="off__who">{t.barberId ? t.barberName : <strong>Todo el local</strong>}</span>
                  <span className="off__why small">{t.reason ?? ''}</span>
                  <button type="button" className="icon-btn icon-btn--sm" onClick={() => removeOff(t.id)}
                    disabled={deleting === t.id} aria-label="Quitar este día libre">
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {panel?.type === 'barber' && (
        <BarberForm
          key={panel.barber?.id ?? 'new'}
          barber={panel.barber}
          services={services.data ?? []}
          onClose={close}
          onSaved={async () => { await barbers.reload(); shop.reload(); close(); }}
        />
      )}
      {panel?.type === 'off' && (
        <TimeOffForm barbers={list.filter((b) => b.active)} onClose={close} onSaved={() => timeOff.reload()} />
      )}
    </div>
  );
}

function BarberForm({ barber, services, onClose, onSaved }) {
  const { api } = useAuth();
  const [form, setForm] = useState(() => ({
    name: barber?.name ?? '',
    photoUrl: barber?.photoUrl ?? '',
    active: barber?.active ?? true,
    serviceIds: barber?.serviceIds ?? services.filter((s) => s.active).map((s) => s.id),
    hours: barber?.hours ?? [],
  }));
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const dayRanges = (wd) => form.hours.filter((h) => h.weekday === wd);
  const setDay = (wd, ranges) => set({ hours: [...form.hours.filter((h) => h.weekday !== wd), ...ranges.map((r) => ({ ...r, weekday: wd }))] });
  const copyToWorkingDays = (wd) => {
    const src = dayRanges(wd);
    const working = DAYS.filter((d) => d.wd !== wd && dayRanges(d.wd).length > 0).map((d) => d.wd);
    set({ hours: [...form.hours.filter((h) => !working.includes(h.weekday)), ...working.flatMap((w) => src.map((r) => ({ ...r, weekday: w })))] });
  };

  const submit = async (e) => {
    e.preventDefault();
    setErrors({});
    setFailure(null);
    setSaving(true);
    try {
      await api.saveBarber(barber?.id, {
        name: form.name, photoUrl: form.photoUrl.trim(), active: form.active,
        serviceIds: form.serviceIds, hours: form.hours.map(({ weekday, start, end }) => ({ weekday, start, end })),
      });
      await onSaved();
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) setErrors(fe); else setFailure(err);
      setSaving(false);
    }
  };

  return (
    <Panel title={barber ? barber.name : 'Nuevo barbero'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="b-name">Nombre</label>
          <input id="b-name" className="input" value={form.name} maxLength={40}
            aria-invalid={!!errors.name} onChange={(e) => set({ name: e.target.value })} />
          {errors.name && <span className="field__error">{errors.name}</span>}
        </div>
        <div className="field">
          <label className="field__label" htmlFor="b-photo">Foto <span className="small">(link, opcional)</span></label>
          <input id="b-photo" className="input" type="url" value={form.photoUrl} placeholder="https://…"
            aria-invalid={!!errors.photoUrl} onChange={(e) => set({ photoUrl: e.target.value })} />
          {errors.photoUrl && <span className="field__error">{errors.photoUrl}</span>}
        </div>

        <fieldset className="field fieldset">
          <legend className="field__label">Horario semanal</legend>
          <div className="week">
            {DAYS.map((d) => {
              const ranges = dayRanges(d.wd);
              const works = ranges.length > 0;
              return (
                <div key={d.wd} className={`week__day${works ? '' : ' week__day--off'}`}>
                  <label className="check week__toggle">
                    <input type="checkbox" checked={works}
                      onChange={(e) => setDay(d.wd, e.target.checked ? [{ start: '09:00', end: '13:00' }] : [])} />
                    <span>{d.name}</span>
                  </label>
                  <div className="week__ranges">
                    {!works && <span className="small">No trabaja</span>}
                    {ranges.map((r, i) => (
                      <span key={i} className="range">
                        <input type="time" step={900} className="input input--time" value={r.start}
                          aria-label={`${d.name}, tramo ${i + 1}, desde`}
                          onChange={(e) => setDay(d.wd, ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                        <span aria-hidden="true">–</span>
                        <input type="time" step={900} className="input input--time" value={r.end}
                          aria-label={`${d.name}, tramo ${i + 1}, hasta`}
                          onChange={(e) => setDay(d.wd, ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                        <button type="button" className="icon-btn icon-btn--sm" aria-label={`Quitar tramo ${i + 1} del ${d.name}`}
                          onClick={() => setDay(d.wd, ranges.filter((_, j) => j !== i))}>
                          <X size={14} aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                    {works && (
                      <span className="week__links">
                        {ranges.length < 3 && (
                          <button type="button" className="link-btn"
                            onClick={() => setDay(d.wd, [...ranges, ranges.length ? { start: '17:00', end: '21:00' } : { start: '09:00', end: '13:00' }])}>
                            + Tramo
                          </button>
                        )}
                        <button type="button" className="link-btn" onClick={() => copyToWorkingDays(d.wd)}>Copiar a los otros días</button>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {errors.hours && <span className="field__error">{errors.hours}</span>}
        </fieldset>

        <fieldset className="field fieldset">
          <legend className="field__label">Servicios que hace</legend>
          {services.map((s) => (
            <label key={s.id} className="check">
              <input type="checkbox" checked={form.serviceIds.includes(s.id)}
                onChange={() => set({ serviceIds: form.serviceIds.includes(s.id) ? form.serviceIds.filter((x) => x !== s.id) : [...form.serviceIds, s.id] })} />
              <span>{s.name}{!s.active && <span className="small"> (no se ofrece)</span>}</span>
            </label>
          ))}
        </fieldset>

        <label className="check check--block">
          <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
          <span>
            Atiende
            <span className="field__hint" style={{ display: 'block' }}>Si lo apagás, no aparece para reservar. Sus turnos ya tomados siguen en la agenda.</span>
          </span>
        </label>

        {failure && <Notice tone="error" title="No se pudo guardar">{failure.message}</Notice>}
        <button type="submit" className="btn btn--primary btn--block" disabled={saving} style={{ marginTop: 8 }}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
    </Panel>
  );
}

function TimeOffForm({ barbers, onClose, onSaved }) {
  const { api } = useAuth();
  const today = todayStr();
  const [form, setForm] = useState({ barberId: '', fromDate: today, toDate: today, allDay: true, fromTime: '09:00', toTime: '13:00', reason: '' });
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch, ...(patch.fromDate && patch.fromDate > f.toDate ? { toDate: patch.fromDate } : {}) }));

  const submit = async (e) => {
    e.preventDefault();
    setFailure(null);
    setSaving(true);
    try {
      const r = await api.createTimeOff({
        barberId: form.barberId || null, fromDate: form.fromDate, toDate: form.toDate,
        fromTime: form.allDay ? null : form.fromTime, toTime: form.allDay ? null : form.toTime, reason: form.reason || null,
      });
      await onSaved();
      if (r.affected.length === 0) onClose();
      else setResult(r);
    } catch (err) {
      setFailure(err);
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <Panel title="Día libre cargado" onClose={onClose}>
        <Notice tone="warn" title={`Hay ${result.affected.length} ${result.affected.length === 1 ? 'turno tomado' : 'turnos tomados'} en ese rango`}>
          No se cancelan solos. Avisales y cancelalos desde la agenda.
        </Notice>
        <ul className="msgs" style={{ marginTop: 12 }}>
          {result.affected.map((a) => (
            <li key={a.id} className="msg">
              <Link to={`/admin?dia=${a.date}&turno=${a.id}`}>{shortDate(a.date)} · {a.time}</Link>
              <span className="msg__status">{a.customerName} con {a.barberName}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn--secondary btn--block" style={{ marginTop: 16 }} onClick={onClose}>Listo</button>
      </Panel>
    );
  }

  return (
    <Panel title="Agregar día libre" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="o-who">Quién</label>
          <select id="o-who" className="input" value={form.barberId} onChange={(e) => set({ barberId: e.target.value })}>
            <option value="">Todo el local (feriado, vacaciones)</option>
            {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="field-row">
          <div className="field">
            <label className="field__label" htmlFor="o-from">Desde</label>
            <input id="o-from" type="date" className="input" min={today} value={form.fromDate} onChange={(e) => e.target.value && set({ fromDate: e.target.value })} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="o-to">Hasta</label>
            <input id="o-to" type="date" className="input" min={form.fromDate} value={form.toDate} onChange={(e) => e.target.value && set({ toDate: e.target.value })} />
          </div>
        </div>
        <label className="check check--block">
          <input type="checkbox" checked={form.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
          <span>Todo el día</span>
        </label>
        {!form.allDay && (
          <div className="field-row">
            <div className="field">
              <label className="field__label" htmlFor="o-ft">Desde la hora</label>
              <input id="o-ft" type="time" step={900} className="input" value={form.fromTime} onChange={(e) => set({ fromTime: e.target.value })} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="o-tt">Hasta la hora</label>
              <input id="o-tt" type="time" step={900} className="input" value={form.toTime} onChange={(e) => set({ toTime: e.target.value })} />
            </div>
          </div>
        )}
        <div className="field">
          <label className="field__label" htmlFor="o-why">Motivo <span className="small">(opcional, solo lo ves vos)</span></label>
          <input id="o-why" className="input" maxLength={80} value={form.reason} placeholder="Feriado, vacaciones, turno médico…"
            onChange={(e) => set({ reason: e.target.value })} />
        </div>
        {failure && <Notice tone="error" title="No se pudo guardar">{failure.message}</Notice>}
        <button type="submit" className="btn btn--primary btn--block" disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar día libre'}
        </button>
      </form>
    </Panel>
  );
}
