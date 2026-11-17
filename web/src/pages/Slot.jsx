import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBarber, useShop, useService } from '../lib/shop.jsx';
import { api } from '../lib/api.js';
import { addDays, dayChip, duration, longDate, price, relativeDay, todayStr, weekdayAndDay } from '../lib/format.js';
import { FlowBar, Notice, SkeletonRows } from '../components/ui.jsx';
import NotFound from './NotFound.jsx';

const MIDDAY = '13:00';

/** C3 — Elegí día y hora. Solo se muestran horarios libres, en celdas enteras. */
export default function Slot() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { status, data } = useShop();
  const service = useService(params.get('servicio'));
  const barberParam = params.get('barbero') ?? 'any';
  const barber = useBarber(barberParam);
  const today = todayStr();
  const date = params.get('dia') ?? today;

  const [avail, setAvail] = useState({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const selectedDayRef = useRef(null);

  useEffect(() => {
    if (!service) return undefined;
    let alive = true;
    setAvail({ status: 'loading' });
    api.availability({ serviceId: service.id, barberId: barberParam === 'any' ? null : barberParam, date })
      .then((r) => alive && setAvail({ status: 'ready', ...r }))
      .catch((error) => alive && setAvail({ status: 'error', error }));
    return () => { alive = false; };
  }, [service, barberParam, date, reloadKey]);

  useEffect(() => {
    selectedDayRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [date, status]);

  if (status === 'loading') return <><FlowBar /><main className="page"><div style={{ height: 32 }} /><SkeletonRows count={3} /></main></>;
  if (!service) return <NotFound />;

  const multi = service.barberIds.length > 1;
  const totalSteps = multi ? 3 : 2;
  const backTo = multi ? `/reservar/barbero?${new URLSearchParams({ servicio: service.id })}` : '/';
  const days = Array.from({ length: data.shop.bookingWindowDays + 1 }, (_, i) => addDays(today, i));
  const lastDay = days.at(-1);

  const setDate = (d) => setParams((p) => { p.set('dia', d); return p; }, { replace: true });
  const pick = (slot) => navigate(`/reservar/datos?${new URLSearchParams({
    servicio: service.id, barbero: barberParam, inicio: slot.startsAt,
  })}`);

  const slots = avail.status === 'ready' ? avail.slots : [];
  const groups = [
    { title: 'Mañana', items: slots.filter((s) => s.time < MIDDAY) },
    { title: 'Tarde', items: slots.filter((s) => s.time >= MIDDAY) },
  ].filter((g) => g.items.length);

  const nextDay = date < lastDay ? addDays(date, 1) : null;
  const nextDayBtn = nextDay && (
    <button type="button" className="btn btn--secondary" onClick={() => setDate(nextDay)}>
      Ver {relativeDay(nextDay)?.toLowerCase() ?? `el ${weekdayAndDay(nextDay)}`}
    </button>
  );

  return (
    <>
      <FlowBar backTo={backTo} step={`Paso ${multi ? 2 : 1} de ${totalSteps}`} />
      <main className="page">
        <h1 className="page-title">Elegí día y hora</h1>
        <p className="choice">
          <strong>{service.name}</strong><span className="choice__dot">·</span>
          <span>{duration(service.durationMin)}</span><span className="choice__dot">·</span>
          <span>{price(service.priceArs)}</span><span className="choice__dot">·</span>
          <span>{barber ? `con ${barber.name}` : 'cualquier barbero'}</span>
        </p>

        <div className="days" role="group" aria-label="Día">
          {days.map((d) => {
            const c = dayChip(d);
            const selected = d === date;
            return (
              <button
                key={d}
                ref={selected ? selectedDayRef : undefined}
                type="button"
                className="day"
                aria-pressed={selected}
                aria-label={longDate(d)}
                onClick={() => setDate(d)}
              >
                <span className="day__wd">{d === today ? 'HOY' : c.wd}</span>
                <span className="day__n">{c.n}</span>
              </button>
            );
          })}
        </div>

        <h2 className="section-head" style={{ fontSize: 18, fontWeight: 600 }}>
          {relativeDay(date) ? `${relativeDay(date)}, ` : ''}{longDate(date)}
        </h2>

        {avail.status === 'loading' && <SkeletonRows count={2} height={48} />}

        {avail.status === 'error' && (
          <Notice
            tone="error"
            title="No pudimos traer los horarios"
            action={<button type="button" className="btn btn--secondary" onClick={() => setReloadKey((k) => k + 1)}>Reintentar</button>}
          >
            {avail.error.message}
          </Notice>
        )}

        {avail.status === 'ready' && avail.reason === 'closed' && (
          <Notice title="Ese día no atendemos" action={nextDayBtn} />
        )}
        {avail.status === 'ready' && avail.reason === 'full' && (
          <Notice title="No quedan turnos libres este día" action={nextDayBtn}>
            {barber ? 'Probá otro día o elegí "Cualquiera disponible".' : 'Probá otro día.'}
          </Notice>
        )}
        {avail.status === 'ready' && avail.reason === 'out_of_window' && (
          <Notice title="Ese día todavía no se puede reservar" />
        )}

        {groups.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h3 className="label" style={{ margin: '20px 0 10px' }}>{g.title}</h3>
            <div className="slots">
              {g.items.map((s) => (
                <button key={s.startsAt} type="button" className="slot" onClick={() => pick(s)}>
                  {s.time}
                </button>
              ))}
            </div>
          </section>
        ))}
      </main>
    </>
  );
}
