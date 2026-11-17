import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Download, Printer } from 'lucide-react';
import { useAuth } from './auth.jsx';
import { useShop } from '../lib/shop.jsx';
import { Notice } from '../components/ui.jsx';
import { fieldErrors, useLoad } from './useLoad.js';

const PUBLIC_URL = `${window.location.origin}/`;

const NUMBERS = [
  { key: 'slotStepMin', label: 'Los turnos arrancan cada', unit: 'min', min: 5, max: 120, step: 5,
    hint: 'Con 15: 9:00, 9:15, 9:30…' },
  { key: 'bookingWindowDays', label: 'Se puede reservar hasta', unit: 'días antes', min: 1, max: 90, step: 1 },
  { key: 'minNoticeMin', label: 'Anticipación mínima', unit: 'min', min: 0, max: 1440, step: 15,
    hint: 'Con 60, a las 10:00 ya no se puede reservar para las 10:30.' },
  { key: 'cancelLimitHours', label: 'Cancelar online hasta', unit: 'h antes', min: 0, max: 72, step: 1,
    hint: 'Después, el cliente tiene que avisar por WhatsApp.' },
  { key: 'reminderHoursBefore', label: 'Recordatorio por WhatsApp', unit: 'h antes', min: 1, max: 72, step: 1,
    hint: 'Los recordatorios que todavía no salieron se reprograman.' },
];

/** A8 — Ajustes del local, link público y QR para imprimir. */
export default function Ajustes() {
  const { api } = useAuth();
  const shop = useShop();
  const settings = useLoad((a) => a.settings());
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.data && !form) {
      const s = settings.data;
      setForm({ ...s, logoUrl: s.logoUrl ?? '', address: s.address ?? '', mapsUrl: s.mapsUrl ?? '', whatsappPhone: s.whatsappPhone ?? '' });
    }
  }, [settings.data, form]);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setSaved(false); };

  const submit = async (e) => {
    e.preventDefault();
    setErrors({});
    setFailure(null);
    setSaving(true);
    try {
      const s = await api.saveSettings({
        name: form.name, logoUrl: form.logoUrl.trim(), address: form.address.trim(), mapsUrl: form.mapsUrl.trim(),
        whatsappPhone: form.whatsappPhone.trim(),
        ...Object.fromEntries(NUMBERS.map((n) => [n.key, Number(form[n.key])])),
      });
      setForm({ ...s, logoUrl: s.logoUrl ?? '', address: s.address ?? '', mapsUrl: s.mapsUrl ?? '', whatsappPhone: s.whatsappPhone ?? '' });
      setSaved(true);
      shop.reload();
    } catch (err) {
      const fe = fieldErrors(err);
      if (err.code === 'INVALID_PHONE') setErrors({ whatsappPhone: err.message });
      else if (Object.keys(fe).length) setErrors(fe);
      else setFailure(err);
    } finally {
      setSaving(false);
    }
  };

  const text = (key, label, props = {}) => (
    <div className="field">
      <label className="field__label" htmlFor={`a-${key}`}>{label}</label>
      <input id={`a-${key}`} className="input" value={form[key]} aria-invalid={!!errors[key]}
        onChange={(e) => set({ [key]: e.target.value })} {...props} />
      {errors[key] ? <span className="field__error">{errors[key]}</span> : props.hint && <span className="field__hint">{props.hint}</span>}
    </div>
  );

  return (
    <div className="page-admin page-admin--narrow">
      <header className="settings__head">
        <div>
          <h1 className="agenda__title">Ajustes</h1>
          <p className="lead" style={{ marginTop: 6 }}>Datos del local y reglas para reservar.</p>
        </div>
      </header>

      <QrSection name={form?.name ?? shop.data?.shop.name ?? 'Barbería'} />

      {settings.status === 'loading' && <div className="skeleton" style={{ height: 320 }} />}
      {settings.status === 'error' && <Notice tone="error" title="No pudimos cargar los ajustes">{settings.error.message}</Notice>}

      {form && (
        <form onSubmit={submit} noValidate>
          <section className="settings__section">
            <h2 className="settings__h2">El local</h2>
            {text('name', 'Nombre', { maxLength: 60 })}
            {text('address', 'Dirección', { maxLength: 120, placeholder: 'Caseros 100, Salta' })}
            {text('mapsUrl', 'Link de Google Maps', { type: 'url', placeholder: 'https://maps.app.goo.gl/…', hint: 'Para el botón "Cómo llegar".' })}
            {text('whatsappPhone', 'WhatsApp del local', { type: 'tel', placeholder: '387 412 3456', hint: 'Para que el cliente avise si no llega.' })}
            {text('logoUrl', 'Logo (link a la imagen)', { type: 'url', placeholder: 'https://…', hint: 'Opcional. Se muestra arriba del nombre.' })}
          </section>

          <section className="settings__section">
            <h2 className="settings__h2">Reservas</h2>
            {NUMBERS.map((n) => (
              <div key={n.key} className="field">
                <label className="field__label" htmlFor={`a-${n.key}`}>{n.label}</label>
                <span className="unit-input">
                  <input id={`a-${n.key}`} className="input input--num" type="number" inputMode="numeric"
                    min={n.min} max={n.max} step={n.step} value={form[n.key]} aria-invalid={!!errors[n.key]}
                    onChange={(e) => set({ [n.key]: e.target.value })} />
                  <span className="unit-input__unit">{n.unit}</span>
                </span>
                {errors[n.key] ? <span className="field__error">{errors[n.key]}</span> : n.hint && <span className="field__hint">{n.hint}</span>}
              </div>
            ))}
          </section>

          {failure && <Notice tone="error" title="No se pudo guardar">{failure.message}</Notice>}
          <div className="sticky-cta sticky-cta--admin">
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Guardando…' : saved ? <><Check size={18} aria-hidden="true" /> Guardado</> : 'Guardar cambios'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function QrSection({ name }) {
  const [svg, setSvg] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toString(PUBLIC_URL, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then(setSvg).catch(() => setSvg(''));
  }, []);

  const copy = async () => {
    try { await navigator.clipboard.writeText(PUBLIC_URL); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* */ }
  };

  const downloadPng = async () => {
    const url = await QRCode.toDataURL(PUBLIC_URL, { width: 1200, margin: 2, errorCorrectionLevel: 'M' });
    Object.assign(document.createElement('a'), { href: url, download: 'qr-turnos.png' }).click();
  };

  const printPoster = () => {
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w) return;
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    w.document.write(`<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><title>QR · ${esc(name)}</title>
      <style>
        @page { size: A5; margin: 14mm; }
        body { font-family: system-ui, sans-serif; text-align: center; color: #121012; margin: 0; }
        h1 { font-size: 34px; text-transform: uppercase; letter-spacing: .02em; margin: 24px 0 6px; font-stretch: condensed; }
        p { font-size: 20px; margin: 0 0 18px; }
        .qr { width: 78%; max-width: 360px; margin: 0 auto; }
        .qr svg { width: 100%; height: auto; display: block; }
        small { display: block; margin-top: 14px; font-size: 14px; color: #555; }
      </style></head><body>
      <h1>${esc(name)}</h1><p>Escaneá y reservá tu turno</p>
      <div class="qr">${svg}</div><small>${esc(PUBLIC_URL)}</small>
      <script>window.onload = () => { window.print(); }<\/script></body></html>`);
    w.document.close();
  };

  return (
    <section className="settings__section qr-card">
      <div className="qr-card__code" aria-label="Código QR del link de reservas" role="img"
        dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="qr-card__body">
        <h2 className="settings__h2">Link para reservar</h2>
        <p className="qr-card__url">{PUBLIC_URL}</p>
        <p className="small" style={{ margin: '4px 0 14px' }}>Ponelo en la bio de Instagram, en el estado de WhatsApp y el QR en el espejo.</p>
        <div className="qr-card__actions">
          <button type="button" className="btn btn--secondary btn--sm" onClick={copy}>
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? 'Copiado' : 'Copiar link'}
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={downloadPng}>
            <Download size={16} aria-hidden="true" /> QR en PNG
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={printPoster} disabled={!svg}>
            <Printer size={16} aria-hidden="true" /> Imprimir cartel
          </button>
        </div>
      </div>
    </section>
  );
}
