// API de desarrollo SIN Supabase: Postgres en memoria (PGlite) con la migración y los datos de ejemplo.
// Se borra todo al cortar el proceso. Uso: npm run dev:api:mem (desde la raíz).
//
// Login del panel en este modo (solo existe acá, nunca en producción):
//   email:      duenio@ejemplo.test
//   contraseña: demo-ejemplo
import express from 'express';
import { createTestDb, createUser, signTestToken, testVerifier, SEED } from '../test/helpers.js';
import { createApp } from '../src/app.js';
import { createManualAppointment } from '../src/services/admin.js';
import { createNotifier } from '../src/whatsapp/dispatcher.js';
import { createConsoleSender } from '../src/whatsapp/sender.js';
import { localDate, zonedToUtc } from '../src/lib/time.js';

const DEV_EMAIL = 'duenio@ejemplo.test';
const DEV_PASSWORD = 'demo-ejemplo';
const PORT = Number(process.env.PORT ?? 3000);
const tz = 'America/Argentina/Salta';

const db = await createTestDb();
const owner = await createUser(db, { email: DEV_EMAIL });

// Turnos de ejemplo para HOY, así la agenda tiene algo que mostrar
const today = localDate(new Date(), tz);
const demo = [
  ['09:30', SEED.nico, SEED.corte, 'Diego Ejemplo'], ['10:00', SEED.fede, SEED.corteBarba, 'Ramiro Ejemplo'],
  ['11:00', SEED.nico, SEED.barba, 'Tomás Ejemplo'], ['12:15', SEED.fede, SEED.corte, 'Gonzalo Ejemplo'],
  ['17:00', SEED.nico, SEED.corteBarba, 'Facundo Ejemplo'], ['18:30', SEED.fede, SEED.corte, 'Agustín Ejemplo'],
  ['19:00', SEED.nico, SEED.corte, 'Emiliano Ejemplo'], ['20:15', SEED.fede, SEED.corte, 'Nahuel Ejemplo'],
];
let i = 0;
for (const [hhmm, barberId, serviceId, name] of demo) {
  i += 1;
  const startsAt = zonedToUtc(today, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), tz).toISOString();
  // La mitad con celular (falso) para que haya mensajes de WhatsApp simulados
  const phone = i % 2 === 0 ? `+5493879000${String(i).padStart(3, '0')}` : null;
  await createManualAppointment(db, { serviceId, barberId, startsAt, name, phone }, new Date())
    .catch((err) => console.warn(`Turno de ejemplo ${hhmm} no cargado: ${err.message}`));
}

// WhatsApp simulado: los mensajes se imprimen en la consola de esta API
const notifier = createNotifier({ db, send: createConsoleSender(), webUrl: 'http://localhost:5173' });
await notifier.runOnce();
// Un fallo de ejemplo para ver la pantalla de Recordatorios con algo que reintentar
await db.query(`update notifications set status = 'failed', error = 'Ejemplo: el número no tiene WhatsApp (131026)'
                 where id = (select id from notifications where status = 'sent' order by created_at limit 1)`);

const app = express();
app.use(express.json());
// Login falso que imita a Supabase Auth: devuelve un JWT firmado con la clave de prueba
app.post('/api/dev/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (email !== DEV_EMAIL || password !== DEV_PASSWORD) {
    return res.status(400).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email o contraseña incorrectos.' } });
  }
  return res.json({ accessToken: await signTestToken(owner), email: DEV_EMAIL });
});
app.use(createApp({
  db, corsOrigins: ['http://localhost:5173'], rateLimit: false, verifyToken: testVerifier,
  notifier, cronSecret: 'cron-dev',
}));
// Sin cron en local: cada minuto se despacha lo que ya tiene que salir
setInterval(() => notifier.kick(), 60_000);

app.listen(PORT, () => console.log(`API (base en memoria, datos de ejemplo) en http://localhost:${PORT}`));
