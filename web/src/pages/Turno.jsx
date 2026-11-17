import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { CalendarPlus, Check, Copy, MapPin, MessageCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { icsFile, longDate } from '../lib/format.js';
import { Etiqueta } from '../components/Etiqueta.jsx';
import { Notice, SkeletonRows } from '../components/ui.jsx';

const waLink = (phone, text) => `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

/**
 * C5 (fresh: recién reservado) y C6 (link del WhatsApp: ver y cancelar).
 */
export default function Turno({ fresh = false }) {
  const { token } = useParams();
  const { state } = useLocation();
  const [res, setRes] = useState({ status: 'loading' });
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const [justCancelled, setJustCancelled] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    api.appointment(token)
      .then((a) => {
        if (!alive) return;
        setRes({ status: 'ready', a });
        document.title = `Turno ${a.time} · ${a.shop.name}`;
      })
      .catch((error) => alive && setRes({ status: 'error', error }));
    return () => { alive = false; };
  }, [token]);

  if (res.status === 'loading') {
    return <main className="page" style={{ paddingTop: 40 }}><SkeletonRows count={1} height={420} /></main>;
  }
  if (res.status === 'error') {
    return (
      <main className="page" style={{ paddingTop: 48 }}>
        <Notice
          tone="error"
          title={res.error.status === 404 ? 'No encontramos ese turno' : 'No pudimos cargar el turno'}
          action={<Link className="btn btn--secondary" to="/">Reservar un turno</Link>}
        >
          {res.error.status === 404 ? 'Revisá que el link esté completo.' : res.error.message}
        </Notice>
      </main>
    );
  }

  const a = res.a;
  const manageUrl = `${window.location.origin}/t/${token}`;
  const booked = a.status === 'booked';
  const sameDay = state?.warnings?.includes('SAME_DAY_BOOKING');

  const addToCalendar = () => {
    const blob = icsFile({
      title: `${a.service.name} · ${a.shop.name}`,
      startsAt: a.startsAt, endsAt: a.endsAt, location: a.shop.address, url: manageUrl,
    });
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'turno.ics' });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(manageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { window.prompt('Copiá el link de tu turno:', manageUrl); }
  };

  const cancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      const updated = await api.cancel(token);
      setRes({ status: 'ready', a: updated });
      setJustCancelled(true);
      setConfirming(false);
    } catch (err) {
      setCancelError(err);
      // El estado pudo cambiar (ej. pasó el plazo): refrescar
      api.appointment(token).then((x) => setRes({ status: 'ready', a: x })).catch(() => {});
    } finally {
      setCancelling(false);
    }
  };

  let title = 'Tu turno';
  let lead = null;
  if (justCancelled) {
    title = 'Turno cancelado';
    lead = <>Listo, el horario quedó libre. Te avisamos por WhatsApp.</>;
  } else if (fresh && booked) {
    title = 'Turno reservado';
    lead = <>Te esperamos el <strong>{longDate(a.date)}</strong> a las <strong>{a.time}</strong>. Te llega la confirmación por WhatsApp.</>;
  } else if (booked) {
    lead = <>Te esperamos el <strong>{longDate(a.date)}</strong> a las <strong>{a.time}</strong>.</>;
  }

  return (
    <main className="page" style={{ paddingTop: 'calc(28px + env(safe-area-inset-top))' }}>
      <h1 className="page-title" style={{ marginTop: 0 }}>{title}</h1>
      {lead && <p className="lead">{lead}</p>}

      {sameDay && booked && (
        <Notice tone="warn" title="Ya tenías otro turno ese día">
          Si fue sin querer, cancelá el que no uses desde su link.
        </Notice>
      )}

      <Etiqueta appointment={a} />

      {booked && (
        <div className="actions">
          <button type="button" className="btn btn--secondary" onClick={addToCalendar}>
            <CalendarPlus size={18} aria-hidden="true" /> Agendar
          </button>
          {a.shop.mapsUrl ? (
            <a className="btn btn--secondary" href={a.shop.mapsUrl} target="_blank" rel="noreferrer">
              <MapPin size={18} aria-hidden="true" /> Cómo llegar
            </a>
          ) : (
            <button type="button" className="btn btn--secondary" onClick={copyLink}>
              {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
              {copied ? 'Copiado' : 'Copiar link'}
            </button>
          )}
        </div>
      )}

      {fresh && booked && (
        <p className="small" style={{ marginTop: 16 }}>
          En el WhatsApp te llega este mismo turno, con el link para verlo o cancelarlo.{' '}
          {a.shop.mapsUrl && (
            <button type="button" onClick={copyLink} className="link-btn">
              {copied ? 'Link copiado' : 'Copiar link'}
            </button>
          )}
        </p>
      )}

      {/* Zona de cancelación: aislada, con confirmación en dos pasos */}
      {booked && a.cancel.allowed && (
        <section className="cancel-zone" aria-label="Cancelar turno">
          {!confirming ? (
            <>
              <p className="small" style={{ margin: '0 0 12px' }}>¿No podés venir? Cancelalo así el horario queda para otro.</p>
              <button type="button" className="btn btn--danger btn--block" onClick={() => setConfirming(true)}>
                Cancelar turno
              </button>
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 12px', fontWeight: 600 }}>¿Seguro que querés cancelar el turno de las {a.time}?</p>
              <div className="actions" style={{ marginTop: 0 }}>
                <button type="button" className="btn btn--secondary" onClick={() => setConfirming(false)} disabled={cancelling}>
                  Mantener
                </button>
                <button type="button" className="btn btn--danger" onClick={cancel} disabled={cancelling}>
                  {cancelling ? 'Cancelando…' : 'Sí, cancelar'}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {cancelError && (
        <Notice tone="error" title="No se pudo cancelar">{cancelError.message}</Notice>
      )}

      {booked && !a.cancel.allowed && a.cancel.reason === 'TOO_LATE' && (
        <Notice
          title="Ya no se puede cancelar online"
          action={a.shop.whatsappPhone && (
            <a className="btn btn--secondary" href={waLink(a.shop.whatsappPhone, `Hola, no voy a poder ir a mi turno de las ${a.time} (${a.number}).`)} target="_blank" rel="noreferrer">
              <MessageCircle size={18} aria-hidden="true" /> Avisar por WhatsApp
            </a>
          )}
        >
          Falta poco para el turno. Si no podés venir, avisanos por WhatsApp.
        </Notice>
      )}

      {!booked && (
        <div style={{ marginTop: 24 }}>
          <Link className="btn btn--primary btn--block" to="/">Reservar otro turno</Link>
        </div>
      )}
    </main>
  );
}
