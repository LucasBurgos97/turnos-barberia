# Turnos Barbería

Sistema de turnos online para una barbería de Salta. Ver [PLAN.md](PLAN.md), [DESIGN.md](DESIGN.md) y [PRODUCT.md](PRODUCT.md).

| Carpeta | Qué es |
|---|---|
| `supabase/` | Base de datos: migración, datos de ejemplo y pruebas |
| `api/` | API Node + Express (Render) |
| `web/` | Frontend React + Vite (Vercel) |

## Probarlo en tu compu sin Supabase

En dos terminales distintas:

```bash
npm install
```

```bash
npm run dev:api:mem
```

```bash
npm run dev:web
```

Abrí http://localhost:5173. La API usa una base en memoria con datos de ejemplo, y se borra todo al cortarla.

El panel del dueño está en http://localhost:5173/admin. En este modo los datos de acceso de prueba están en `api/scripts/dev-memory.js`, y la agenda de hoy ya trae turnos de ejemplo.

## Con Supabase

Seguí [supabase/README.md](supabase/README.md). Completá `api/.env` (ver `api/.env.example`) y `web/.env` (ver `web/.env.example`), y usá `npm run dev:api` en lugar de `dev:api:mem`.

## Deploy

Supabase + Render (API) + Vercel (web): paso a paso en [docs/deploy.md](docs/deploy.md). WhatsApp: [docs/whatsapp.md](docs/whatsapp.md).

Después de deployar:

```bash
node scripts/smoke.mjs https://TU-API.onrender.com https://TU-WEB.vercel.app
```

## Pruebas

```bash
npm test
```
