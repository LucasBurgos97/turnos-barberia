// Prueba rápida después de deployar. Solo lee: no crea turnos ni manda mensajes.
// Uso: node scripts/smoke.mjs https://TU-API.onrender.com https://TU-WEB.vercel.app
const [apiArg, webArg] = process.argv.slice(2);
if (!apiArg) {
  console.error('Uso: node scripts/smoke.mjs <URL de la API> [URL de la web]');
  process.exit(1);
}
const API = apiArg.replace(/\/$/, '');
const WEB = webArg?.replace(/\/$/, '');
let failed = 0;

async function check(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    console.log(`✔ ${name} (${Date.now() - t} ms)${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    failed += 1;
    console.log(`✖ ${name} — ${err.message}`);
  }
}
const json = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(body)}`);
  return body;
};
const tzDate = (offsetDays) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Salta' })
  .format(new Date(Date.now() + offsetDays * 86_400_000));

console.log(`API: ${API}${WEB ? `\nWeb: ${WEB}` : ''}\n(la primera respuesta puede tardar si Render estaba dormido)\n`);

await check('API viva y base conectada', async () => {
  const h = await json(`${API}/health?db=1`);
  if (!h.db) throw new Error('sin base');
  const warn = [!h.adminAuth && 'panel sin SUPABASE_URL', !h.whatsapp && 'WhatsApp apagado'].filter(Boolean);
  return warn.length ? `ojo: ${warn.join(', ')}` : 'panel y WhatsApp configurados';
});

let shop;
await check('Datos del local', async () => {
  shop = await json(`${API}/api/shop`);
  if (!shop.services.length) throw new Error('no hay servicios activos');
  return `${shop.shop.name} · ${shop.services.length} servicios · ${shop.barbers.length} barberos`;
});

await check('Hay horarios para reservar en los próximos 7 días', async () => {
  const svc = shop?.services.find((s) => s.barberIds.length);
  if (!svc) throw new Error('ningún servicio tiene barbero');
  for (let d = 0; d < 7; d += 1) {
    const a = await json(`${API}/api/availability?serviceId=${svc.id}&date=${tzDate(d)}`);
    if (a.slots.length) return `${tzDate(d)}: ${a.slots.length} horarios de "${svc.name}"`;
  }
  throw new Error('ningún día con horarios: revisá los horarios de los barberos');
});

await check('Panel protegido', async () => {
  const res = await fetch(`${API}/api/admin/agenda?date=${tzDate(0)}`);
  if (res.status !== 401) throw new Error(`esperaba 401 y vino ${res.status}`);
});

if (WEB) {
  await check('CORS: la web puede llamar a la API', async () => {
    const res = await fetch(`${API}/api/shop`, { headers: { origin: WEB } });
    const allowed = res.headers.get('access-control-allow-origin');
    if (allowed !== WEB) throw new Error(`CORS_ORIGINS no incluye ${WEB} (vino "${allowed}")`);
  });
  await check('La web carga y las rutas internas también', async () => {
    for (const path of ['/', '/admin', '/t/link-de-prueba']) {
      const res = await fetch(WEB + path);
      const html = await res.text();
      if (!res.ok || !html.includes('id="root"')) throw new Error(`${path} → HTTP ${res.status}`);
    }
  });
}

console.log(failed ? `\n${failed} chequeo(s) fallaron.` : '\nTodo bien.');
process.exit(failed ? 1 : 0);
