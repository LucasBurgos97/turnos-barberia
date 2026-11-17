import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { ShopProvider, useShop } from './lib/shop.jsx';
import { ShopError } from './components/ui.jsx';
import Services from './pages/Services.jsx';
import Barber from './pages/Barber.jsx';
import Slot from './pages/Slot.jsx';
import Details from './pages/Details.jsx';
import Turno from './pages/Turno.jsx';
import NotFound from './pages/NotFound.jsx';

// El panel del dueño se carga aparte: el cliente en el celular no descarga ese código
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function BookingRoutes() {
  const { status, error, reload } = useShop();
  if (status === 'error') return <ShopError error={error} onRetry={reload} />;
  return (
    <Routes>
      <Route path="/" element={<Services />} />
      <Route path="/reservar/barbero" element={<Barber />} />
      <Route path="/reservar/horario" element={<Slot />} />
      <Route path="/reservar/datos" element={<Details />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        {/* El link del turno no necesita cargar el local: trae todo lo suyo */}
        <Route path="/turno/:token" element={<Turno fresh />} />
        <Route path="/t/:token" element={<Turno />} />
        <Route path="/admin/*" element={<Suspense fallback={<div className="admin-loading" />}><AdminApp /></Suspense>} />
        <Route path="*" element={<ShopProvider><BookingRoutes /></ShopProvider>} />
      </Routes>
    </>
  );
}
