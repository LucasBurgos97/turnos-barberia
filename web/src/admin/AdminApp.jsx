import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import { ShopProvider } from '../lib/shop.jsx';
import Login from './Login.jsx';
import AdminLayout from './AdminLayout.jsx';
import Agenda from './Agenda.jsx';
import Recordatorios from './Recordatorios.jsx';
import Servicios from './Servicios.jsx';
import Barberos from './Barberos.jsx';
import Ajustes from './Ajustes.jsx';

function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <div className="admin-loading" aria-busy="true" />;
  if (status === 'out') return <Navigate to="/admin/login" replace state={{ from: location }} />;
  return children;
}

export default function AdminApp() {
  return (
    <AuthProvider>
      <ShopProvider>
        <Routes>
          <Route path="login" element={<Login />} />
          <Route
            path="*"
            element={(
              <RequireAuth>
                <AdminLayout>
                  <Routes>
                    <Route index element={<Agenda />} />
                    <Route path="recordatorios" element={<Recordatorios />} />
                    <Route path="servicios" element={<Servicios />} />
                    <Route path="barberos" element={<Barberos />} />
                    <Route path="ajustes" element={<Ajustes />} />
                    <Route path="*" element={<Navigate to="/admin" replace />} />
                  </Routes>
                </AdminLayout>
              </RequireAuth>
            )}
          />
        </Routes>
      </ShopProvider>
    </AuthProvider>
  );
}
