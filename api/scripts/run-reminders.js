// Comando para el Render Cron Job: le pide a la API que mande los WhatsApp pendientes.
// Render → New → Cron Job · Schedule: */10 * * * * · Command: node api/scripts/run-reminders.js
// Variables: API_URL (https://tu-api.onrender.com) y CRON_SECRET (el mismo que la API).
const { API_URL, CRON_SECRET } = process.env;
if (!API_URL || !CRON_SECRET) {
  console.error('Faltan API_URL o CRON_SECRET');
  process.exit(1);
}

// La API de Render free puede estar dormida: el primer pedido la despierta (hasta ~1 min)
// Render puede pasar solo el host (sin https://)
const base = (API_URL.startsWith('http') ? API_URL : `https://${API_URL}`).replace(/\/$/, '');
const res = await fetch(`${base}/internal/reminders/run`, {
  method: 'POST',
  headers: { 'x-cron-secret': CRON_SECRET },
  signal: AbortSignal.timeout(90_000),
});
const body = await res.text();
console.log(res.status, body);
if (!res.ok) process.exit(1);
