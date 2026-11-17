import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Users } from 'lucide-react';
import { useShop, useService } from '../lib/shop.jsx';
import { duration, price } from '../lib/format.js';
import { FlowBar, SkeletonRows } from '../components/ui.jsx';
import NotFound from './NotFound.jsx';

/** C2 — Elegí barbero ("Cualquiera" primero). */
export default function Barber() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { status, data } = useShop();
  const service = useService(params.get('servicio'));

  if (status === 'loading') return <><FlowBar backTo="/" step="Paso 1 de 3" /><main className="page"><div style={{ height: 32 }} /><SkeletonRows count={3} /></main></>;
  if (!service) return <NotFound />;

  const barbers = data.barbers.filter((b) => service.barberIds.includes(b.id));
  const pick = (barberId) => navigate(`/reservar/horario?${new URLSearchParams({ servicio: service.id, barbero: barberId })}`);

  return (
    <>
      <FlowBar backTo="/" step="Paso 1 de 3" />
      <main className="page">
        <h1 className="page-title">¿Con quién?</h1>
        <p className="choice">
          <strong>{service.name}</strong><span className="choice__dot">·</span>
          <span>{duration(service.durationMin)}</span><span className="choice__dot">·</span>
          <span>{price(service.priceArs)}</span>
        </p>

        <ul className="ledger">
          <li>
            <button type="button" className="row-btn row-btn--barber" onClick={() => pick('any')}>
              <span className="avatar"><Users size={20} aria-hidden="true" /></span>
              <span>
                <span className="row-btn__name">Cualquiera disponible</span>
                <span className="row-btn__sub">Más horarios para elegir</span>
              </span>
              <ChevronRight className="row-btn__chev" size={20} aria-hidden="true" />
            </button>
          </li>
          {barbers.map((b) => (
            <li key={b.id}>
              <button type="button" className="row-btn row-btn--barber" onClick={() => pick(b.id)}>
                {b.photoUrl
                  ? <img className="avatar" src={b.photoUrl} alt="" />
                  : <span className="avatar" aria-hidden="true">{b.name.charAt(0)}</span>}
                <span className="row-btn__name">{b.name}</span>
                <ChevronRight className="row-btn__chev" size={20} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
