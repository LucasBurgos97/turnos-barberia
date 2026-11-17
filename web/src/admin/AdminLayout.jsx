import { NavLink } from 'react-router-dom';
import { Bell, CalendarDays, LogOut, Scissors, Settings, Users } from 'lucide-react';
import { useAuth } from './auth.jsx';
import { useShop } from '../lib/shop.jsx';

const NAV = [
  { to: '/admin', label: 'Agenda', Icon: CalendarDays, ready: true },
  { to: '/admin/servicios', label: 'Servicios', Icon: Scissors, ready: true },
  { to: '/admin/barberos', label: 'Barberos', Icon: Users, ready: true },
  { to: '/admin/recordatorios', label: 'Recordatorios', Icon: Bell, ready: true },
  { to: '/admin/ajustes', label: 'Ajustes', Icon: Settings, ready: true },
];

/** Rail malbec a la izquierda + área de trabajo. */
export default function AdminLayout({ children }) {
  const { email, signOut } = useAuth();
  const { data } = useShop();

  return (
    <div className="admin">
      <nav className="rail" aria-label="Panel">
        <span className="rail__shop">{data?.shop.name ?? 'Barbería'}</span>
        <ul className="rail__nav">
          {NAV.map(({ to, label, Icon, ready }) => (
            <li key={label}>
              {ready ? (
                <NavLink to={to} end className="rail__link">
                  <Icon size={18} aria-hidden="true" /> <span>{label}</span>
                </NavLink>
              ) : (
                <span className="rail__link rail__link--soon" aria-disabled="true" title="Próximamente">
                  <Icon size={18} aria-hidden="true" /> <span>{label}</span>
                  <span className="rail__soon">Pronto</span>
                </span>
              )}
            </li>
          ))}
        </ul>
        <div className="rail__foot">
          <span className="rail__email" title={email ?? ''}>{email}</span>
          <button type="button" className="rail__link rail__logout" onClick={signOut}>
            <LogOut size={18} aria-hidden="true" /> <span>Salir</span>
          </button>
        </div>
      </nav>
      <div className="admin__main">{children}</div>
    </div>
  );
}
