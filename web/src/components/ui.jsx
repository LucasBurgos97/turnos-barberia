import { useNavigate } from 'react-router-dom';
import { ChevronLeft, MapPin } from 'lucide-react';
import { useShop } from '../lib/shop.jsx';

/** Banda malbec con la identidad del local (pantalla de inicio). */
export function ShopBand({ shop }) {
  return (
    <header className="shop-band">
      <div className="shop-band__inner">
        {shop.logoUrl && <img className="shop-band__logo" src={shop.logoUrl} alt="" />}
        <h1 className="shop-band__name">{shop.name}</h1>
        {(shop.address || shop.mapsUrl) && (
          <div className="shop-band__meta">
            {shop.mapsUrl ? (
              <a href={shop.mapsUrl} target="_blank" rel="noreferrer">
                <MapPin size={16} aria-hidden="true" />
                {shop.address ?? 'Cómo llegar'}
              </a>
            ) : (
              <span>{shop.address}</span>
            )}
          </div>
        )}
        <div className="shop-band__rule" />
      </div>
    </header>
  );
}

/** Barra superior del flujo de reserva: volver, nombre del local y paso. */
export function FlowBar({ step, backTo }) {
  const navigate = useNavigate();
  const { data } = useShop();
  return (
    <div className="flow-bar">
      <div className="flow-bar__inner">
        <button
          type="button"
          className="flow-bar__back"
          onClick={() => (backTo ? navigate(backTo) : navigate(-1))}
          aria-label="Volver"
        >
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
        <span className="flow-bar__shop">{data?.shop.name}</span>
        {step && <span className="flow-bar__step">{step}</span>}
      </div>
    </div>
  );
}

export function Notice({ tone, title, children, action }) {
  return (
    <div className={`notice${tone ? ` notice--${tone}` : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      <p className="notice__title">{title}</p>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function SkeletonRows({ count = 4, height = 64 }) {
  return (
    <div aria-busy="true" aria-label="Cargando">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, marginBottom: 8 }} />
      ))}
    </div>
  );
}

/** Pantalla de error al cargar el local. */
export function ShopError({ error, onRetry }) {
  return (
    <main className="page" style={{ paddingTop: 48 }}>
      <Notice
        tone="error"
        title="No pudimos cargar la barbería"
        action={<button type="button" className="btn btn--secondary" onClick={onRetry}>Reintentar</button>}
      >
        {error?.message}
      </Notice>
    </main>
  );
}
