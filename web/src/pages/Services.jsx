import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useShop } from '../lib/shop.jsx';
import { duration, price } from '../lib/format.js';
import { Notice, ShopBand, SkeletonRows } from '../components/ui.jsx';

/** C1 — Inicio: identidad del local + servicios como filas del bloque técnico. */
export default function Services() {
  const { status, data, slow } = useShop();
  const navigate = useNavigate();

  if (status === 'loading') {
    return (
      <>
        <div className="shop-band"><div className="shop-band__inner"><div className="skeleton" style={{ height: 56, width: '70%' }} /></div></div>
        <main className="page">
          <div style={{ height: 32 }} />
          {slow && (
            <p className="small" role="status" style={{ marginTop: 0 }}>
              Estamos abriendo la agenda. La primera vez del día puede tardar hasta un minuto.
            </p>
          )}
          <SkeletonRows />
        </main>
      </>
    );
  }

  const bookable = data.services.filter((s) => s.barberIds.length > 0);

  const choose = (s) => {
    const q = new URLSearchParams({ servicio: s.id });
    if (s.barberIds.length === 1) {
      q.set('barbero', s.barberIds[0]);
      navigate(`/reservar/horario?${q}`);
    } else {
      navigate(`/reservar/barbero?${q}`);
    }
  };

  return (
    <>
      <ShopBand shop={data.shop} />
      <main className="page">
        <h2 className="page-title">Elegí el servicio</h2>
        <p className="lead" style={{ marginBottom: 20 }}>Reservá en un minuto, sin llamar.</p>

        {bookable.length === 0 ? (
          <Notice title="Todavía no hay servicios para reservar online">
            {data.shop.whatsappPhone ? 'Escribinos por WhatsApp y te damos un turno.' : 'Volvé a probar en un rato.'}
          </Notice>
        ) : (
          <ul className="ledger">
            {bookable.map((s) => (
              <li key={s.id}>
                <button type="button" className="row-btn" onClick={() => choose(s)}>
                  <span>
                    <span className="row-btn__name">{s.name}</span>
                    <span className="row-btn__sub">{duration(s.durationMin)}</span>
                  </span>
                  <span className="row-btn__price">{price(s.priceArs)}</span>
                  <ChevronRight className="row-btn__chev" size={20} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="small" style={{ marginTop: 32 }}>
          ¿Ya tenés turno? Para verlo o cancelarlo, abrí el link que te llegó por WhatsApp.
        </p>
      </main>
    </>
  );
}
