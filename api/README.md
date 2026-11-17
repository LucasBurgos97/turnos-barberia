# API (Express)

## Correr en local

1. Copiá `.env.example` a `.env` y completá `DATABASE_URL` con el connection string del **pooler** de Supabase.
2. Desde la raíz del repo:

```bash
npm install
```

```bash
npm run dev:api
```

## Pruebas

No necesitan Supabase ni Docker: levantan un Postgres en memoria (PGlite) con la misma migración y el mismo seed.

```bash
npm test
```

## Endpoints públicos

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/health` | `{ ok: true }` |
| GET | `/api/shop` | `{ shop, services[], barbers[] }` |
| GET | `/api/availability?serviceId&date=YYYY-MM-DD&barberId?` | `{ date, reason, slots[{ time, startsAt, barberIds }] }`. `reason`: `null`, `closed`, `full` u `out_of_window` |
| POST | `/api/appointments` | Body `{ serviceId, barberId?, startsAt, name, phone }` → `201 { token, appointment, warnings[] }` |
| GET | `/api/appointments/by-token/:token` | El turno (para C5 y C6) |
| POST | `/api/appointments/by-token/:token/cancel` | El turno cancelado |

`barberId` ausente, `null` o `"any"` significa "cualquiera": se asigna el barbero con menos turnos ese día.

Los errores siempre tienen la forma `{ error: { code, message } }`, con `message` en español y listo para mostrar al usuario.

| Código | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Faltan datos o tienen mal formato (`fields[]` dice cuáles) |
| `INVALID_PHONE` | 400 | No se pudo interpretar el celular |
| `OUT_OF_WINDOW` | 400 | Fecha pasada o más allá de `booking_window_days` |
| `SERVICE_NOT_FOUND` / `BARBER_NOT_FOUND` / `APPOINTMENT_NOT_FOUND` | 404 | — |
| `SLOT_UNAVAILABLE` | 409 | El horario no está libre (o no existe en la grilla) |
| `SLOT_TAKEN` | 409 | Otro cliente lo reservó en el mismo instante |
| `TOO_LATE` / `PAST` / `ALREADY_CANCELLED` / `NOT_ACTIVE` | 409 | No se puede cancelar |
| `TOO_MANY_BOOKINGS` | 429 | Más de 5 reservas por hora con el mismo celular |
| `RATE_LIMITED` | 429 | Más de 10 intentos por minuto desde la misma IP |

`warnings: ["SAME_DAY_BOOKING"]` avisa, sin bloquear, que ese celular ya tenía otro turno ese día.

## Endpoints del panel (requieren `Authorization: Bearer <JWT de Supabase>`)

El usuario tiene que estar en la tabla `admins`. Sin token la API responde `401`; con un token de un usuario que no es admin, `403`.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/admin/me` | Email del dueño logueado |
| GET | `/api/admin/agenda?date=` | Barberos con su horario del día, todos los turnos (también los cancelados) y un resumen |
| GET | `/api/admin/availability?serviceId&barberId&date` | Horarios libres, sin aviso mínimo y hasta 90 días |
| GET | `/api/admin/appointments/:id` | Detalle: cliente con historial y estado de los mensajes de WhatsApp |
| PATCH | `/api/admin/appointments/:id` | `{ status }`: `completed`, `no_show`, `booked` (deshacer) o `cancelled_by_shop` |
| POST | `/api/admin/appointments` | Turno manual `{ serviceId, barberId, startsAt, name, phone? }` |

### Configuración del local

| Método | Ruta | Qué hace |
|---|---|---|
| GET · POST · PATCH `:id` | `/api/admin/services` | Servicios (con `barberIds`). Se desactivan con `active: false`, no se borran |
| POST | `/api/admin/services/reorder` | `{ ids }` en el orden nuevo |
| GET · POST · PATCH `:id` | `/api/admin/barbers` | Barberos con `serviceIds` y `hours: [{ weekday, start, end }]` (reemplaza el horario entero) |
| POST | `/api/admin/barbers/reorder` | `{ ids }` |
| GET · POST · DELETE `:id` | `/api/admin/time-off` | Días libres `{ barberId \| null, fromDate, toDate, fromTime?, toTime?, reason? }`. El POST devuelve `affected[]`: los turnos ya tomados en ese rango |
| GET · PATCH | `/api/admin/settings` | Ajustes del local. Si cambia `reminderHoursBefore`, se reprograman los recordatorios pendientes |

## Estructura

```
src/
  server.js              arranque (lee el entorno)
  app.js                 rutas, validación y manejo de errores
  db.js                  adaptadores de base: pg (Supabase) y PGlite (tests)
  services/booking.js    disponibilidad, reservar, ver y cancelar
  lib/availability.js    cálculo de horarios libres (función pura)
  lib/phone.js           normalización de celulares a E.164
  lib/time.js            conversión de hora de Salta a UTC
test/                    node:test (unitarias + integración con PGlite)
```
