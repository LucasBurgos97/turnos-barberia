# PLAN — Sistema de turnos para una barbería de Salta

Contexto de producto: [PRODUCT.md](PRODUCT.md) · Dirección visual: [DESIGN.md](DESIGN.md)

## Resumen

| | |
|---|---|
| **Alcance** | Una sola barbería, con uno o más barberos |
| **Cliente** | Celular, sin cuenta: nombre + celular |
| **Dueño** | Compu, login con email (Supabase Auth) |
| **Funciones mínimas** | Reservar · Cancelar · Agenda del día · Recordatorio automático por WhatsApp |
| **Stack** | React + Vite (Vercel) · Node + Express (Render) · PostgreSQL (Supabase) |
| **WhatsApp** | WhatsApp Cloud API (Meta) con plantillas aprobadas |
| **Zona horaria** | `America/Argentina/Salta` (UTC−3, sin horario de verano) |

---

## 1. Arquitectura

```
Celular cliente ─┐                         ┌─> Supabase Postgres (datos)
                 ├─> Frontend React (Vercel) ──> API Express (Render) ─┤
Compu dueño ─────┘                         ├─> Supabase Auth (valida JWT del dueño)
                                           └─> WhatsApp Cloud API (Meta)
Render Cron Job (cada 10 min) ──> API: envía recordatorios pendientes
Meta Webhook ──> API: estados de entrega (enviado / entregado / leído / falló)
```

Decisiones:
- **El frontend nunca habla directo con la base.** Todo pasa por Express, que usa la `service_role` key de Supabase. RLS queda activado en todas las tablas sin políticas públicas, como red de seguridad.
- **El dueño se autentica con Supabase Auth** (email + contraseña o magic link). El frontend manda el JWT y Express lo verifica y chequea que el usuario esté en `admins`.
- **El cliente no tiene cuenta.** Cada turno tiene un `cancel_token` aleatorio. El link `/t/:token` le permite ver y cancelar su turno.
- **La disponibilidad la calcula el servidor**, y la base impide los turnos dobles con una restricción de exclusión (ver tabla `appointments`).
- **Render free se duerme** a los 15 minutos sin tráfico, así que los recordatorios **no** pueden depender de un `setInterval` dentro del server. Se usa un **Render Cron Job** (de pago, unos USD 1/mes) o, como alternativa gratis, **`pg_cron` + `pg_net` en Supabase** llamando a `POST /internal/reminders/run` con un secreto.

---

## 2. Pantallas

### Cliente (celular, público)

| # | Ruta | Pantalla | Qué hace | Estados a diseñar |
|---|---|---|---|---|
| C1 | `/` | **Inicio / Servicios** | Encabezado malbec con nombre, logo, dirección y horario. Lista de servicios con duración y precio. Tocar uno avanza. | Cargando · Sin servicios activos · Local cerrado por vacaciones |
| C2 | `/reservar/barbero` | **Elegí barbero** | Barberos que hacen ese servicio, más "Cualquiera disponible" primero. Se saltea si hay un solo barbero. | Un barbero (se saltea) · Ninguno disponible |
| C3 | `/reservar/horario` | **Elegí día y hora** | Tira horizontal de días (hoy + N días). Debajo, una grilla de celdas enteras con solo los horarios libres, agrupados en **Mañana / Tarde** (en Salta es común el horario cortado por la siesta). | Día sin lugar ("Sin turnos libres, probá el jueves") · Día cerrado · Horario tomado mientras elegía → aviso y refresco |
| C4 | `/reservar/datos` | **Tus datos** | Nombre y celular (prefijo `+54 9` fijo, el cliente escribe `387 1234567`). Resumen del turno arriba. Botón "Confirmar turno". | Celular inválido · Ese celular ya tiene un turno ese día (avisar, no bloquear) · Error de red |
| C5 | `/turno/:token` (después de confirmar) | **Confirmación: la etiqueta** | La etiqueta numerada (ver DESIGN.md). "Te mandamos la confirmación por WhatsApp". Botones: Agregar al calendario (.ics) y Cómo llegar (Maps). | WhatsApp falló (el turno igual está confirmado: mostrar el link para guardar) |
| C6 | `/t/:token` | **Mi turno / Cancelar** | La misma etiqueta. Botón "Cancelar turno", aislado, con confirmación en dos pasos. | Ya cancelado · Ya pasó · Fuera del plazo de cancelación ("Escribinos al WhatsApp del local") · Token inválido |

Flujo: **C1 → (C2) → C3 → C4 → C5**, con tres o cuatro toques. El estado del flujo vive en la URL o en el estado de React, nunca en `localStorage` como fuente de verdad.

### Dueño (compu, `/admin`, requiere login)

Layout: **rail lateral malbec** a la izquierda (Agenda, Servicios, Barberos, Recordatorios, Ajustes) y área de trabajo a la derecha.

| # | Ruta | Pantalla | Qué hace | Estados a diseñar |
|---|---|---|---|---|
| A1 | `/admin/login` | **Ingresar** | Email + contraseña (Supabase Auth). | Credenciales inválidas · Usuario sin permiso de admin |
| A2 | `/admin` | **Agenda del día** (pantalla principal) | Selector de día (← Hoy →). Columnas por barbero, o una sola columna si hay uno. Cada turno es una etiqueta compacta: **hora grande**, nombre, servicio y chip de WhatsApp (✓ recordado). El turno **en curso** lleva el anillo cobre. Arriba, un resumen: "8 turnos · 2 libres · próximo 17:30 Nico". Se refresca solo cada 60 s. | Día vacío · Día cerrado · Cancelado por el cliente (queda tachado en su lugar y marcado) · Turno nuevo entró (marca "nuevo") |
| A3 | panel lateral sobre A2 | **Detalle de turno** | Datos del cliente con botón "Abrir WhatsApp" (wa.me), historial (cantidad de turnos y faltas), estado de mensajes. Acciones: **Asistió**, **No vino** y **Cancelar** (aislada; avisa al cliente por WhatsApp). | Cliente con faltas previas (aviso) |
| A4 | modal sobre A2 | **Turno manual** | Para quien llama o llega sin turno: servicio, barbero, hora, nombre y celular (opcional). Respeta la misma disponibilidad. | Choque de horario |
| A5 | `/admin/servicios` | **Servicios** | Tabla: nombre, duración, precio, activo y orden. Crear y editar en panel. | Sin servicios (estado inicial: "Cargá tu primer servicio") |
| A6 | `/admin/barberos` | **Barberos y horarios** | Por barbero: nombre, foto, servicios que hace y **horario semanal con varios tramos por día** (ej. 9–13 y 17–21). Bloqueos: vacaciones, feriados, "cierro temprano hoy". | Barbero sin horario cargado (no aparece en reservas: avisar) |
| A7 | `/admin/recordatorios` | **Recordatorios** | Log de mensajes: tipo, cliente, turno, estado (en cola, enviado, entregado, leído, falló) y error. Botón "Reintentar" en los fallidos. | Sin WhatsApp configurado · Plantilla rechazada |
| A8 | `/admin/ajustes` | **Ajustes del local** | Nombre, logo, dirección, link de Maps, WhatsApp del local. Reglas: duración del bloque, días de anticipación, aviso mínimo, plazo de cancelación y horas antes del recordatorio. Link público y **QR descargable** para imprimir en el local. | — |

Mobile del admin: A2 tiene que funcionar en celular (el dueño la va a mirar desde el teléfono también), con columnas apiladas por barbero. El resto puede ser solo desktop en el MVP.

---

## 3. Base de datos (PostgreSQL / Supabase)

Extensiones: `pgcrypto` (UUIDs y tokens) y `btree_gist` (anti turno doble).

### `shop_settings` (una sola fila)
| Columna | Tipo | Nota |
|---|---|---|
| `id` | `smallint` PK | Siempre 1 (`check (id = 1)`) |
| `name` | `text` | |
| `logo_url` | `text` null | Supabase Storage |
| `address`, `maps_url` | `text` | |
| `whatsapp_phone` | `text` | Número del local, en formato E.164 |
| `timezone` | `text` | `'America/Argentina/Salta'` |
| `slot_step_min` | `int` | Cada cuánto arrancan los turnos (ej. 15) |
| `booking_window_days` | `int` | Ej. 14 días hacia adelante |
| `min_notice_min` | `int` | Ej. 60: no se puede reservar para dentro de menos de 1 h |
| `cancel_limit_hours` | `int` | Ej. 3: cancelación online hasta 3 h antes |
| `reminder_hours_before` | `int` | Ej. 3 (o 24) |
| `updated_at` | `timestamptz` | |

### `admins`
| `user_id` | `uuid` PK → `auth.users.id` | Quién puede entrar al admin |

### `barbers`
| Columna | Tipo | Nota |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text` | |
| `photo_url` | `text` null | |
| `active` | `bool` default true | |
| `sort_order` | `int` | |

### `services`
| Columna | Tipo | Nota |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text` | "Corte", "Corte + barba", "Barba" |
| `duration_min` | `int` | `check (duration_min > 0)` |
| `price_ars` | `int` | En pesos, sin decimales |
| `active` | `bool` | |
| `sort_order` | `int` | |

### `barber_services` (qué hace cada barbero)
| `barber_id` → `barbers` · `service_id` → `services` | PK compuesta |

### `working_hours` (horario semanal, varios tramos por día)
| Columna | Tipo | Nota |
|---|---|---|
| `id` | `uuid` PK | |
| `barber_id` | `uuid` → `barbers` | |
| `weekday` | `smallint` | 0 = domingo … 6 = sábado |
| `start_time`, `end_time` | `time` | `check (end_time > start_time)` |

Ejemplo: martes 09:00–13:00 y martes 17:00–21:00 son **dos filas**.

### `time_off` (bloqueos: vacaciones, feriados, imprevistos)
| Columna | Tipo | Nota |
|---|---|---|
| `id` | `uuid` PK | |
| `barber_id` | `uuid` null → `barbers` | `null` = cierra todo el local |
| `starts_at`, `ends_at` | `timestamptz` | |
| `reason` | `text` null | |

### `customers`
| Columna | Tipo | Nota |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text` | |
| `phone` | `text` **unique** | E.164 normalizado: `+549387…` |
| `notes` | `text` null | Notas del dueño |
| `no_show_count` | `int` default 0 | |
| `created_at` | `timestamptz` | |

Si el mismo celular reserva otra vez, se reutiliza el cliente y se actualiza el nombre si cambió.

### `appointments`
| Columna | Tipo | Nota |
|---|---|---|
| `id` | `uuid` PK | |
| `number` | `bigint` generated identity | El **Nº 0142** de la etiqueta |
| `barber_id` | `uuid` → `barbers` | |
| `service_id` | `uuid` → `services` | |
| `customer_id` | `uuid` → `customers` | |
| `starts_at`, `ends_at` | `timestamptz` | `ends_at = starts_at + duración` |
| `status` | enum `appointment_status` | `booked`, `completed`, `no_show`, `cancelled_by_customer`, `cancelled_by_shop` |
| `source` | enum | `online`, `manual` |
| `service_name_snapshot`, `price_snapshot` | `text`, `int` | Para que un cambio de precio no altere turnos viejos |
| `cancel_token` | `text` unique | 32 bytes aleatorios en base64url |
| `created_at`, `cancelled_at` | `timestamptz` | |

**Anti turno doble (clave):**
```sql
alter table appointments add constraint no_overlap
  exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'booked');
```
Si dos clientes tocan el mismo horario al mismo tiempo, el segundo `insert` falla. La API responde `409` y el frontend muestra "Ese horario se acaba de ocupar".

Índices: `(barber_id, starts_at)` y `(starts_at)` para la agenda del día.

### `notifications` (mensajes de WhatsApp)
| Columna | Tipo | Nota |
|---|---|---|
| `id` | `uuid` PK | |
| `appointment_id` | `uuid` → `appointments` | |
| `kind` | enum | `confirmation`, `reminder`, `cancellation` |
| `status` | enum | `scheduled`, `sending`, `sent`, `delivered`, `read`, `failed`, `skipped` |
| `scheduled_for` | `timestamptz` | Recordatorio = `starts_at − reminder_hours_before` |
| `provider_message_id` | `text` null | ID de Meta, para cruzar con el webhook |
| `attempts` | `int` default 0 | |
| `error` | `text` null | |
| `sent_at`, `updated_at` | `timestamptz` | |

Unique `(appointment_id, kind)`, para que un recordatorio no se mande dos veces aunque el cron corra superpuesto. El cron toma los pendientes con `select … for update skip locked`.

Al cancelar un turno, su recordatorio pendiente pasa a `skipped`.

---

## 4. API (Express)

**Pública (cliente)**
| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/shop` | Datos del local, servicios activos y barberos activos |
| GET | `/api/availability?serviceId&barberId?&date` | Horarios libres de ese día (si no hay `barberId`, la unión de todos) |
| POST | `/api/appointments` | Crea el turno (con "cualquiera", asigna al barbero libre con menos turnos ese día). Devuelve el token. Encola la confirmación por WhatsApp |
| GET | `/api/appointments/by-token/:token` | Ver el turno |
| POST | `/api/appointments/by-token/:token/cancel` | Cancelar (valida el plazo) |

**Admin (JWT de Supabase y usuario en `admins`)**
| Método | Ruta |
|---|---|
| GET | `/api/admin/agenda?date=YYYY-MM-DD` |
| POST | `/api/admin/appointments` (turno manual) |
| PATCH | `/api/admin/appointments/:id` (asistió, no vino, cancelar) |
| CRUD | `/api/admin/services`, `/api/admin/barbers`, `/api/admin/working-hours`, `/api/admin/time-off` |
| GET/PUT | `/api/admin/settings` |
| GET | `/api/admin/notifications` · POST `/api/admin/notifications/:id/retry` |

**Interna**
| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/internal/reminders/run` | La llama el cron. Protegida con el header `X-Cron-Secret` |
| GET/POST | `/webhooks/whatsapp` | Verificación y estados de Meta. Valida la firma `X-Hub-Signature-256` |

Reglas en el servidor: validación con `zod`, rate limit en `POST /api/appointments` (por IP y por celular) y todas las fechas en UTC en la base, convertidas a hora de Salta solo para mostrar.

**Cálculo de disponibilidad:** tramos de `working_hours` del día − `time_off` − turnos `booked` → se parte en inicios cada `slot_step_min` donde entre la duración del servicio → se filtra `min_notice_min`.

---

## 5. WhatsApp (Cloud API de Meta)

Plantillas a aprobar (categoría *Utility*). **Los textos definitivos están en [docs/whatsapp.md](docs/whatsapp.md)**; el recordatorio cambió para que sirva también si sale el día anterior ("mañana a las…"):
1. **`turno_confirmado`**: "Hola {{1}}, tu turno en {{2}} quedó confirmado: {{3}} a las {{4}} con {{5}}. Si no podés venir, cancelalo acá: {{6}}"
2. **`turno_recordatorio`**: "Hola {{1}}, te recordamos tu turno en {{2}}: {{3}} a las {{4}}. ¿No llegás? Cancelalo acá así el horario le sirve a otro: {{5}}"
3. **`turno_cancelado`**: "Hola {{1}}, tu turno en {{2}} del {{3}} a las {{4}} quedó cancelado. Si querés sacar otro: {{5}}"

Puntos a tener en cuenta:
- **Formato de número argentino:** el cliente escribe `387 15 123 4567` o `0387 4123456`. Hay que sacar el `0` y el `15` y dejar `+549387…`. Hay que probar con números reales, porque es la fuente de error número uno.
- **Trámite de Meta:** Business Manager, verificación del negocio, un número **que no esté en uso en la app de WhatsApp común** y aprobación de plantillas. **Puede tardar días o semanas: arrancarlo en la fase 0.**
- **Costo:** se paga por conversación o mensaje de utilidad según la tarifa de Meta para Argentina. Hay que revisar el precio vigente antes de lanzar.
- **Si WhatsApp falla, el turno no falla.** La notificación queda en `failed`, se ve en A7 y se puede reintentar.
- **Plan B mientras Meta no aprueba:** en A3 y A7 hay un botón "Abrir WhatsApp" (wa.me con el texto armado) para mandar a mano.

---

## 6. Orden de trabajo

### Fase 0: Cuentas y trámites (día 1, en paralelo con todo)
- [ ] Crear el proyecto en Supabase (región São Paulo, la más cercana).
- [ ] **Empezar el alta en Meta Business + WhatsApp Cloud API** y conseguir un número dedicado.
- [ ] Repo con `/web` (Vite) y `/api` (Express). Monorepo simple con npm workspaces.
- [ ] Archivos `.env.example` para los dos lados.
- [ ] Pedirle al dueño: nombre, logo, fotos, servicios con precios y duraciones, horarios y barberos.

### Fase 1: Base de datos
- [x] Migraciones SQL con todas las tablas, enums, la restricción `no_overlap`, los índices y RLS activado → `supabase/migrations/`.
- [x] Seed con datos de ejemplo **marcados como ejemplo** (2 barberos, 4 servicios, horario cortado) → `supabase/seed.sql`.
- [x] Pruebas del esquema → `supabase/tests/`.
- [ ] Crear el proyecto en Supabase, correr la migración y crear el usuario dueño en `admins` (pasos en `supabase/README.md`).

### Fase 2: API núcleo
- [x] `GET /api/shop`, cálculo de disponibilidad y tests de la función (tramos, bloqueos, aviso mínimo, borde de medianoche).
- [x] `POST /api/appointments` con manejo del `409` por superposición.
- [x] Ver y cancelar por token, validando el plazo.
- [x] Normalización de celular argentino, con tests.
- [ ] Probar contra el Supabase real (falta el proyecto creado).

### Fase 3: Frontend cliente (celular primero)
- [x] Tokens de DESIGN.md como variables CSS y la fuente Archivo servida localmente.
- [x] C1 → C2 → C3 → C4 → C5 → C6, con todos los estados de la tabla.
- [x] La etiqueta numerada como componente único reutilizable.
- [ ] Probar en un celular real a la luz del día.

### Fase 4: Admin: agenda
- [x] Login (A1) y middleware de JWT + `admins` en la API.
- [x] **Agenda del día (A2)**, detalle (A3) y turno manual (A4, en panel lateral en vez de modal).
- [x] Refresco cada 60 s y marca de "nuevo" o "cancelado".
- [ ] Probar el login con Supabase Auth real (hoy solo probado con el login de desarrollo).

### Fase 5: WhatsApp
- [x] Cliente de la Cloud API, envío de `turno_confirmado` al reservar y de `turno_cancelado` al cancelar (salen al toque, sin esperar al cron).
- [x] Endpoint `/internal/reminders/run` y cron (Render Cron Job o `pg_cron`, ver `docs/whatsapp.md`).
- [x] Webhook de estados y pantalla A7 con reintento.
- [x] Plan B wa.me mientras no estén aprobadas las plantillas.
- [ ] Alta en Meta, plantillas aprobadas y prueba con un número real (pasos en `docs/whatsapp.md`).

### Fase 6: Admin: configuración
- [x] Servicios (A5), barberos con horarios y bloqueos (A6) y ajustes con QR (A8).
- [ ] Subir logo y fotos de barberos a Supabase Storage (hoy se pegan como link a una imagen).

### Fase 7: Deploy
- [x] Configuración lista: `render.yaml` (API, health check), `web/vercel.json` (SPA, headers, monorepo), CI en GitHub Actions, `scripts/smoke.mjs`. Guía en `docs/deploy.md`.
- [x] Aviso en la web cuando Render está despertando; cron cada 10 min con pg_cron (gratis) que además lo mantiene despierto.
- [ ] Subir a GitHub y crear Supabase, Render y Vercel siguiendo `docs/deploy.md` (requiere tus cuentas).
- [ ] CORS limitado al dominio de Vercel (`CORS_ORIGINS`), smoke test en verde.
- [ ] Dominio propio (opcional) y QR impreso para el local.

### Fase 8: Prueba piloto (1–2 semanas)
- [ ] El dueño usa el sistema en paralelo con su método actual.
- [ ] Revisar: turnos dobles (debería haber cero), mensajes fallidos y celulares mal normalizados.
- [ ] Recién después: `/impeccable document` para regenerar DESIGN.md desde lo construido.

---

## 7. Decisiones abiertas (las tiene que tomar el dueño o vos)

1. **Proveedor de WhatsApp:** Meta Cloud API directo (más barato, más trámite) o Twilio (más simple, más caro). El plan asume Meta.
2. **Cuándo sale el recordatorio:** ¿24 h antes, 3 h antes o los dos?
3. **Plazo de cancelación online:** ¿hasta cuántas horas antes?
4. **Seña:** ¿se cobra seña con Mercado Pago para reservar? No está en el MVP; sumaría una tabla `payments` y un webhook de MP.
5. **"Cualquier barbero":** ¿se ofrece o el cliente siempre elige?
6. **Clientes que faltan:** ¿se bloquea la reserva online después de N faltas?
7. **Nombre, logo, fotos, servicios y precios reales:** hasta tenerlos, todo es de ejemplo.
