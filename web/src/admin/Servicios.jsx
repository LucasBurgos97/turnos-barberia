import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useAuth } from './auth.jsx';
import { useShop } from '../lib/shop.jsx';
import { duration, price } from '../lib/format.js';
import { Notice } from '../components/ui.jsx';
import Panel from './Panel.jsx';
import { fieldErrors, useLoad } from './useLoad.js';

/** A5 — Servicios: lo que el cliente ve para reservar. */
export default function Servicios() {
  const { api } = useAuth();
  const shop = useShop();
  const services = useLoad((a) => a.services());
  const barbers = useLoad((a) => a.barbers());
  const [editing, setEditing] = useState(null); // null | 'new' | service
  const [moveError, setMoveError] = useState(null);

  const list = services.data ?? [];
  const barberName = (id) => barbers.data?.find((b) => b.id === id)?.name ?? '';

  const move = async (index, dir) => {
    const ids = list.map((s) => s.id);
    const j = index + dir;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setMoveError(null);
    try {
      services.setData(await api.reorderServices(ids));
      shop.reload();
    } catch (err) { setMoveError(err); }
  };

  const onSaved = async () => {
    await services.reload();
    shop.reload();
    setEditing(null);
  };

  return (
    <div className={`settings${editing ? ' settings--with-panel' : ''}`}>
      <div className="page-admin">
        <header className="settings__head">
          <div>
            <h1 className="agenda__title">Servicios</h1>
            <p className="lead" style={{ marginTop: 6 }}>Lo que el cliente ve para reservar, en este orden.</p>
          </div>
          <button type="button" className={`btn ${editing ? 'btn--secondary' : 'btn--primary'}`} onClick={() => setEditing('new')}>
            <Plus size={18} aria-hidden="true" /> Nuevo servicio
          </button>
        </header>

        {services.status === 'loading' && <div className="skeleton" style={{ height: 240 }} />}
        {services.status === 'error' && <Notice tone="error" title="No pudimos cargar los servicios">{services.error.message}</Notice>}
        {moveError && <Notice tone="error" title="No se pudo reordenar">{moveError.message}</Notice>}
        {services.status === 'ready' && list.length === 0 && (
          <Notice title="Cargá tu primer servicio" action={<button type="button" className="btn btn--secondary" onClick={() => setEditing('new')}>Nuevo servicio</button>}>
            Sin servicios, nadie puede reservar online.
          </Notice>
        )}

        {list.length > 0 && (
          <ul className="ledger ledger--admin">
            {list.map((s, i) => (
              <li key={s.id} className={s.active ? '' : 'is-inactive'}>
                <button type="button" className="row-btn row-btn--admin" onClick={() => setEditing(s)}
                  aria-current={editing?.id === s.id || undefined}>
                  <span>
                    <span className="row-btn__name">
                      {s.name}
                      {!s.active && <span className="chip" style={{ marginLeft: 10 }}>No se ofrece</span>}
                    </span>
                    <span className="row-btn__sub">
                      {duration(s.durationMin)} · {s.barberIds.length === 0
                        ? <span className="t-warn">ningún barbero lo hace</span>
                        : s.barberIds.map(barberName).join(', ')}
                    </span>
                  </span>
                  <span className="row-btn__price">{price(s.priceArs)}</span>
                </button>
                <span className="order-btns">
                  <button type="button" className="icon-btn icon-btn--sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir ${s.name}`}>
                    <ArrowUp size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-btn icon-btn--sm" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`Bajar ${s.name}`}>
                    <ArrowDown size={16} aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <ServiceForm
          key={editing === 'new' ? 'new' : editing.id}
          service={editing === 'new' ? null : editing}
          barbers={barbers.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function ServiceForm({ service, barbers, onClose, onSaved }) {
  const { api } = useAuth();
  const [form, setForm] = useState(() => ({
    name: service?.name ?? '',
    durationMin: service?.durationMin ?? 30,
    priceArs: service?.priceArs ?? '',
    active: service?.active ?? true,
    barberIds: service?.barberIds ?? barbers.filter((b) => b.active).map((b) => b.id),
  }));
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggleBarber = (id) => set({ barberIds: form.barberIds.includes(id) ? form.barberIds.filter((b) => b !== id) : [...form.barberIds, id] });

  const submit = async (e) => {
    e.preventDefault();
    setErrors({});
    setFailure(null);
    setSaving(true);
    try {
      await api.saveService(service?.id, {
        name: form.name, durationMin: Number(form.durationMin), priceArs: Number(form.priceArs || 0),
        active: form.active, barberIds: form.barberIds,
      });
      await onSaved();
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) setErrors(fe); else setFailure(err);
      setSaving(false);
    }
  };

  return (
    <Panel title={service ? 'Editar servicio' : 'Nuevo servicio'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="s-name">Nombre</label>
          <input id="s-name" className="input" value={form.name} maxLength={60} placeholder="Corte + barba"
            aria-invalid={!!errors.name} onChange={(e) => set({ name: e.target.value })} />
          {errors.name && <span className="field__error">{errors.name}</span>}
        </div>
        <div className="field-row">
          <div className="field">
            <label className="field__label" htmlFor="s-dur">Duración (min)</label>
            <input id="s-dur" className="input" type="number" inputMode="numeric" min={5} max={480} step={5}
              value={form.durationMin} aria-invalid={!!errors.durationMin} onChange={(e) => set({ durationMin: e.target.value })} />
            {errors.durationMin && <span className="field__error">{errors.durationMin}</span>}
          </div>
          <div className="field">
            <label className="field__label" htmlFor="s-price">Precio ($)</label>
            <input id="s-price" className="input" type="number" inputMode="numeric" min={0} step={500}
              value={form.priceArs} aria-invalid={!!errors.priceArs} onChange={(e) => set({ priceArs: e.target.value })} />
            {errors.priceArs && <span className="field__error">{errors.priceArs}</span>}
          </div>
        </div>

        <fieldset className="field fieldset">
          <legend className="field__label">Quién lo hace</legend>
          {barbers.length === 0 && <span className="field__hint">Primero cargá barberos.</span>}
          {barbers.map((b) => (
            <label key={b.id} className="check">
              <input type="checkbox" checked={form.barberIds.includes(b.id)} onChange={() => toggleBarber(b.id)} />
              <span>{b.name}{!b.active && <span className="small"> (inactivo)</span>}</span>
            </label>
          ))}
          {form.barberIds.length === 0 && barbers.length > 0 && (
            <span className="field__hint t-warn">Sin barbero, este servicio no aparece para reservar.</span>
          )}
        </fieldset>

        <label className="check check--block">
          <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
          <span>
            Se puede reservar online
            <span className="field__hint" style={{ display: 'block' }}>Si lo apagás, deja de ofrecerse. Los turnos ya tomados siguen.</span>
          </span>
        </label>

        {service?.upcoming > 0 && (
          <p className="small">Tiene {service.upcoming} {service.upcoming === 1 ? 'turno próximo' : 'turnos próximos'}: cambiar el precio no los modifica.</p>
        )}
        {failure && <Notice tone="error" title="No se pudo guardar">{failure.message}</Notice>}

        <button type="submit" className="btn btn--primary btn--block" disabled={saving} style={{ marginTop: 8 }}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
    </Panel>
  );
}
