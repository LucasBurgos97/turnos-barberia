import { Link } from 'react-router-dom';
import { Notice } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <main className="page" style={{ paddingTop: 48 }}>
      <Notice
        title="Esta página no existe"
        action={<Link className="btn btn--secondary" to="/">Ir a reservar</Link>}
      >
        Puede que el link esté incompleto.
      </Notice>
    </main>
  );
}
