import { createApp } from './app.js';
import { createPgDb } from './db.js';
import { createJwtVerifier } from './auth.js';
import { createCloudApiSender, createConsoleSender } from './whatsapp/sender.js';
import { createNotifier } from './whatsapp/dispatcher.js';

const {
  DATABASE_URL, PORT = '3000', CORS_ORIGINS = '', DEFAULT_AREA_CODE = '387',
  SUPABASE_URL, SUPABASE_JWT_SECRET,
  PUBLIC_WEB_URL, CRON_SECRET,
  WHATSAPP_MODE = 'cloud', WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_API_VERSION,
  WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET,
} = process.env;

if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL (ver api/.env.example)');
  process.exit(1);
}

const db = createPgDb(DATABASE_URL);

// WhatsApp: "cloud" (Meta) si hay credenciales, "console" para probar sin mandar nada, o apagado.
let notifier;
if (!PUBLIC_WEB_URL) {
  console.warn('Sin PUBLIC_WEB_URL: no se mandan WhatsApp (hace falta para armar los links).');
} else if (WHATSAPP_MODE === 'console') {
  notifier = createNotifier({ db, send: createConsoleSender(), webUrl: PUBLIC_WEB_URL });
  console.warn('WhatsApp en modo consola: los mensajes se muestran en el log, no se mandan.');
} else if (WHATSAPP_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
  const send = createCloudApiSender({
    token: WHATSAPP_TOKEN, phoneNumberId: WHATSAPP_PHONE_NUMBER_ID, apiVersion: WHATSAPP_API_VERSION || undefined,
  });
  notifier = createNotifier({ db, send, webUrl: PUBLIC_WEB_URL });
} else {
  console.warn('Sin WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID: los mensajes quedan en cola sin mandarse.');
}

const app = createApp({
  db,
  corsOrigins: CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  defaultArea: DEFAULT_AREA_CODE,
  verifyToken: SUPABASE_URL || SUPABASE_JWT_SECRET
    ? createJwtVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: SUPABASE_JWT_SECRET })
    : undefined,
  notifier,
  cronSecret: CRON_SECRET,
  webhook: { verifyToken: WHATSAPP_VERIFY_TOKEN, appSecret: WHATSAPP_APP_SECRET },
});
if (!SUPABASE_URL && !SUPABASE_JWT_SECRET) console.warn('Sin SUPABASE_URL: el panel del dueño queda deshabilitado.');
if (!CRON_SECRET) console.warn('Sin CRON_SECRET: /internal/reminders/run queda cerrado.');

const server = app.listen(Number(PORT), () => console.log(`API escuchando en :${PORT}`));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => db.close().then(() => process.exit(0))));
}
