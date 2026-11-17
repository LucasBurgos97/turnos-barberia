import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AUTH_MODE, useAuth } from './auth.jsx';
import { useShop } from '../lib/shop.jsx';

/** A1 — Ingresar al panel. */
export default function Login() {
  const { status, signIn } = useAuth();
  const { data } = useShop();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  if (status === 'in') return <Navigate to={location.state?.from?.pathname ?? '/admin'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.email.trim() || !form.password) { setError('Completá email y contraseña.'); return; }
    setSending(true);
    try {
      await signIn(form.email.trim(), form.password);
      navigate(location.state?.from?.pathname ?? '/admin', { replace: true });
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  };

  return (
    <div className="login">
      <div className="login__band">
        <span className="login__shop">{data?.shop.name ?? 'Barbería'}</span>
        <span className="label login__sub">Panel del local</span>
      </div>
      <main className="login__main">
        <form className="login__form" onSubmit={submit} noValidate>
          <h1 className="page-title" style={{ marginTop: 0 }}>Ingresar</h1>
          {error && <p className="field__error" role="alert" style={{ margin: '0 0 16px' }}>{error}</p>}
          <div className="field">
            <label className="field__label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="username" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="password">Contraseña</label>
            <input id="password" className="input" type="password" autoComplete="current-password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <button type="submit" className="btn btn--primary btn--block" disabled={sending}>
            {sending ? 'Entrando…' : 'Entrar'}
          </button>
          {AUTH_MODE === 'dev' && (
            <p className="small" style={{ marginTop: 16 }}>
              Modo desarrollo: los datos de acceso de prueba están en <code>api/scripts/dev-memory.js</code>.
            </p>
          )}
        </form>
      </main>
    </div>
  );
}
