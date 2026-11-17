# Deploy paso a paso

Orden: **GitHub → Supabase → Render (API) → Vercel (web) → volver a Render → cron → prueba**. Hay que ir y volver porque la API necesita la URL de la web, y la web la de la API. Calculá alrededor de una hora, sin contar el trámite de WhatsApp.

Todo entra en los planes gratis, salvo el cron de Render (opcional, desde USD 1 por mes). La alternativa gratis es la del paso 6.

---

## 1. GitHub

Subí este proyecto a un repositorio **privado** de GitHub. Render y Vercel lo leen desde ahí y redeployan solos con cada push a `main`. El workflow `.github/workflows/ci.yml` corre las pruebas y el build en cada push.

`.gitignore` ya deja afuera los `.env` y `node_modules`. **Nunca subas un `.env`.**

## 2. Supabase

1. Creá el proyecto en la región **South America (São Paulo)** y guardá la contraseña de la base.
2. En el **SQL Editor**, corré `supabase/migrations/20261117000000_init.sql`. El `seed.sql` es solo para pruebas: en producción **no** lo corras, así no quedan "Nico (ejemplo)" ni "Barbería Ejemplo". En su lugar:
   ```sql
   insert into public.shop_settings (id, name) values (1, 'NOMBRE REAL DE LA BARBERÍA');
   ```
   El resto (barberos, servicios, horarios) se carga después desde el panel.
3. **Authentication → Sign In / Providers:** dejá activo **Email** y **desactivá "Allow new users to sign up"**. El panel igual rechaza a quien no esté en `admins`, pero así nadie puede crearse una cuenta.
4. **Authentication → Users → Add user:** el email y la contraseña del dueño, con *Auto Confirm User* tildado. Después:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'EMAIL_DEL_DUEÑO';
   ```
5. Anotá estos datos para los pasos siguientes:
   - **Project Settings → Database → Connection string → Transaction pooler** (puerto 6543), con tu contraseña puesta → `DATABASE_URL`.
   - **Project Settings → API → Project URL** → `SUPABASE_URL` y `VITE_SUPABASE_URL`.
   - **Project Settings → API → anon public** → `VITE_SUPABASE_ANON_KEY`. Es pública y puede ir en la web.
   - **No** uses la `service_role` en ningún lado: la API se conecta directo con `DATABASE_URL`.
   - Si en **Project Settings → JWT Keys** el proyecto todavía usa *Legacy JWT secret*, copiá ese secreto → `SUPABASE_JWT_SECRET`. Si usa *JWT Signing Keys*, dejalo vacío: alcanza con `SUPABASE_URL`.

## 3. Render (API)

1. **New → Blueprint** y elegí el repositorio. Render lee `render.yaml` y crea `turnos-api` (plan free, región Virginia, health check en `/health`).
2. Te va a pedir las variables marcadas `sync: false`. Por ahora completá `DATABASE_URL`, `SUPABASE_URL` (y `SUPABASE_JWT_SECRET` si corresponde). Las de WhatsApp pueden quedar vacías hasta tener Meta (ver `docs/whatsapp.md`). `CORS_ORIGINS` y `PUBLIC_WEB_URL` se completan en el paso 5.
3. `CRON_SECRET` y `WHATSAPP_VERIFY_TOKEN` se generan solos. Los ves en Environment.
4. Cuando termine, anotá la URL, por ejemplo `https://turnos-api.onrender.com`, y abrí `/health`: tiene que responder `{"ok":true}`.

## 4. Vercel (web)

1. **Add New → Project**, importá el repositorio.
2. **Root Directory:** `web`. El resto lo toma de `web/vercel.json` (instala con los workspaces desde la raíz, compila con Vite y redirige todas las rutas a la app).
3. **Environment Variables:**
   - `VITE_API_URL` = la URL de Render, sin `/` al final.
   - `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` del paso 2.5.
4. Deploy. Anotá la URL, por ejemplo `https://turnos-barberia.vercel.app`.

> Las `VITE_*` se graban en el build: si las cambiás, hay que redeployar en Vercel.

## 5. Volver a Render

En `turnos-api` → Environment:
- `CORS_ORIGINS` = la URL de Vercel. Si después agregás un dominio propio, ponelo también, separado por coma.
- `PUBLIC_WEB_URL` = la URL de Vercel, o el dominio propio si lo tenés. Con esto se arman los links de los WhatsApp.

Guardá: Render redeploya solo.

## 6. Cron: recordatorios y API despierta (gratis, con pg_cron)

El plan free de Render apaga la API a los 15 minutos sin uso, y el primer pedido después tarda hasta un minuto en despertarla (la web muestra "Estamos abriendo la agenda…"). Un pedido cada 10 minutos hace dos cosas: manda los recordatorios a su hora y mantiene la API despierta. 24 h × 31 días = 744 h, y entra en las 750 h gratis de Render.

En Supabase → **Database → Extensions**, activá `pg_cron` y `pg_net`. Después, en el SQL Editor (reemplazá la URL y el `CRON_SECRET` de Render):

```sql
select cron.schedule(
  'turnos-whatsapp',
  '*/10 * * * *',
  $$ select net.http_post(
       url := 'https://TU-API.onrender.com/internal/reminders/run',
       headers := jsonb_build_object('x-cron-secret', 'TU_CRON_SECRET'),
       timeout_milliseconds := 60000
     ) $$
);
```

Mientras WhatsApp no esté configurado, ese pedido responde 503 ("WhatsApp no está configurado"). Igual sirve para mantener la API despierta.

Si preferís el cron de Render (de pago), descomentá el bloque `cron` de `render.yaml`.

## 7. Probar

```bash
node scripts/smoke.mjs https://TU-API.onrender.com https://TU-WEB.vercel.app
```

Solo lee, no crea nada. Revisa la API y la base, que haya servicios y horarios, que el panel esté protegido, el CORS y que las rutas de la web carguen. Con la base recién creada va a fallar "Hay horarios…" hasta que cargues barberos y servicios: es lo esperado.

Después, a mano:
1. Entrá a `/admin` con el usuario del dueño.
2. En **Ajustes**, completá dirección, Maps y WhatsApp del local.
3. En **Barberos**, cargá cada barbero con su horario. En **Servicios**, los servicios con precio y quién los hace.
4. Desde el celular, reservá un turno de prueba y cancelalo con el link.
5. Volvé a correr el smoke test: ahora tiene que dar todo bien.
6. En **Ajustes → Imprimir cartel**, imprimí el QR para el local.

## 8. Dominio propio (opcional)

Vercel → Settings → Domains → agregá, por ejemplo, `turnos.labarberia.com.ar` y seguí las instrucciones de DNS. Después actualizá en Render `CORS_ORIGINS` (agregalo) y `PUBLIC_WEB_URL` (reemplazalo), y **reimprimí el QR**, que apunta a la URL desde la que abrís el panel.

---

## Variables, resumen

| Dónde | Variable | De dónde sale |
|---|---|---|
| Render | `DATABASE_URL` | Supabase, Transaction pooler (6543) |
| Render | `SUPABASE_URL` | Supabase, Project URL |
| Render | `SUPABASE_JWT_SECRET` | Solo si el proyecto usa el Legacy JWT secret |
| Render | `CORS_ORIGINS` | URL(s) de Vercel o dominio propio |
| Render | `PUBLIC_WEB_URL` | URL pública de la web |
| Render | `CRON_SECRET` | Generado por Render |
| Render | `WHATSAPP_*` | `docs/whatsapp.md` |
| Vercel | `VITE_API_URL` | URL de Render |
| Vercel | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Supabase, API |

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| La web dice "No pudimos cargar la barbería" | Falta `VITE_API_URL`, o `CORS_ORIGINS` no incluye la URL de la web (el smoke test lo detecta) |
| La primera carga tarda casi un minuto | Render estaba dormido: armá el cron del paso 6 |
| `/health?db=1` da 503 | `DATABASE_URL` mal, o usaste la conexión directa en lugar del pooler |
| El login del panel dice "no tiene permiso" | El usuario no está en `admins` (paso 2.4) |
| El login funciona pero el panel vuelve al login | La API no valida el token: falta `SUPABASE_URL` en Render, o falta `SUPABASE_JWT_SECRET` si el proyecto es legacy |
| Los links de WhatsApp apuntan a localhost | `PUBLIC_WEB_URL` en Render |
