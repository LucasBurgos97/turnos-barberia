import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** Panel lateral (no modal): la agenda sigue visible y usable al lado. Escape lo cierra. */
export default function Panel({ title, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="panel" aria-label={title} ref={ref} tabIndex={-1}>
      <header className="panel__head">
        <h2 className="panel__title">{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="panel__body">{children}</div>
    </aside>
  );
}
