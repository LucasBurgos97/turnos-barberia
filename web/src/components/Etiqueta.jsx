import { Ban, Check } from 'lucide-react';
import { price, shortDate, turnoNumber } from '../lib/format.js';

const STAMPS = {
  cancelled_by_customer: { cls: 'void', text: 'Cancelado', Icon: Ban },
  cancelled_by_shop: { cls: 'void', text: 'Cancelado por el local', Icon: Ban },
  no_show: { cls: 'void', text: 'No asistió', Icon: Ban },
  completed: { cls: 'done', text: 'Realizado', Icon: Check },
};

/**
 * La etiqueta numerada: la firma visual del sistema (ver DESIGN.md).
 * @param {{ appointment: object }} props  respuesta de GET /api/appointments/by-token/:token
 */
export function Etiqueta({ appointment: a }) {
  const stamp = STAMPS[a.status];
  const isVoid = stamp?.cls === 'void';

  return (
    <article className={`etiqueta${isVoid ? ' etiqueta--void' : ''}`} aria-label={`Turno ${turnoNumber(a.number)}`}>
      <div className="etiqueta__head">
        <span className="etiqueta__shop">{a.shop.name}</span>
        {stamp && (
          <span className={`stamp stamp--${stamp.cls}`}>
            <stamp.Icon size={14} aria-hidden="true" />
            {stamp.text}
          </span>
        )}
      </div>
      <div className="etiqueta__rule" />
      <dl className="etiqueta__rows">
        <Row k="Turno" v={turnoNumber(a.number)} mod="number" />
        <Row k="Servicio" v={a.service.name} />
        <Row k="Barbero" v={a.barber.name} />
        <Row k="Día" v={shortDate(a.date)} mod="date" />
        <Row k="Hora" v={`${a.time} → ${a.endTime}`} mod="time" />
        <Row k="Valor" v={price(a.service.priceArs)} />
        <Row k="A nombre de" v={a.customer.firstName} />
      </dl>
      <div className="etiqueta__foot">
        <span className="label">Salta · 1.187 msnm</span>
        {a.customer.phone && <span className="label">Cel. {a.customer.phone}</span>}
      </div>
    </article>
  );
}

function Row({ k, v, mod }) {
  return (
    <div className={`etiqueta__row${mod ? ` etiqueta__row--${mod}` : ''}`}>
      <dt className="label">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
