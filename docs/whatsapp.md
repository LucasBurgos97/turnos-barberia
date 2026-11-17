# WhatsApp: cómo conectarlo

El sistema manda tres mensajes por WhatsApp Cloud API (Meta): la **confirmación** apenas se reserva, el **recordatorio** unas horas antes del turno (`reminder_hours_before`, 3 por defecto) y el **aviso de cancelación**. Si WhatsApp falla, el turno queda igual: el mensaje se reintenta solo y, si no sale, aparece como fallido en el panel, en **Recordatorios**.

> El trámite con Meta puede tardar de días a semanas. Mientras tanto el sistema funciona igual: los mensajes quedan en cola y el dueño los puede mandar a mano con el botón **WhatsApp** de cada fila en Recordatorios.

## 1. Alta en Meta

1. Entrá a [business.facebook.com](https://business.facebook.com) y creá el portfolio comercial de la barbería.
2. En [developers.facebook.com](https://developers.facebook.com) creá una app de tipo **Business** y agregale el producto **WhatsApp**.
3. Agregá un **número propio** para el local. Tiene que ser un número que **no** esté usando la app común de WhatsApp ni WhatsApp Business (si lo está usando, primero hay que borrar esa cuenta).
4. Verificá el negocio (Configuración del negocio → Centro de seguridad). Sin verificar se pueden mandar pocos mensajes por día.
5. Creá un **usuario del sistema** con rol de administrador, asignale la app y la cuenta de WhatsApp, y generá un **token permanente** con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Ese es el `WHATSAPP_TOKEN`.
6. En WhatsApp → Configuración de la API, copiá el **Phone number ID** (no es el número de teléfono). Ese es el `WHATSAPP_PHONE_NUMBER_ID`.

## 2. Plantillas (WhatsApp Manager → Plantillas de mensajes)

Las tres van con categoría **Utilidad**, idioma **Español (ARG)** y el texto **exactamente** así, porque el orden de las variables tiene que coincidir con `api/src/whatsapp/templates.js`:

**`turno_confirmado`**
```
Hola {{1}}, tu turno en {{2}} quedó confirmado: {{3}} a las {{4}} con {{5}}. Si no podés venir, cancelalo acá: {{6}}
```
Ejemplos para la revisión: `Martín` · `Barbería Ejemplo` · `jueves 19/11` · `17:30` · `Nico` · `https://tu-dominio/t/abc123`

**`turno_recordatorio`**
```
Hola {{1}}, te recordamos tu turno en {{2}}: {{3}} a las {{4}}. ¿No llegás? Cancelalo acá así el horario le sirve a otro: {{5}}
```
Ejemplos: `Martín` · `Barbería Ejemplo` · `hoy` · `17:30` · `https://tu-dominio/t/abc123`

**`turno_cancelado`**
```
Hola {{1}}, tu turno en {{2}} del {{3}} a las {{4}} quedó cancelado. Si querés sacar otro: {{5}}
```
Ejemplos: `Martín` · `Barbería Ejemplo` · `jueves 19/11` · `17:30` · `https://tu-dominio/`

Si Meta rechaza alguna, ajustá el texto y actualizá también `TEMPLATE_TEXTS` en `templates.js`, manteniendo el mismo orden de variables.

## 3. Variables en Render (servicio de la API)

| Variable | Valor |
|---|---|
| `PUBLIC_WEB_URL` | URL del frontend en Vercel, ej. `https://turnos-barberia.vercel.app` (con ella se arman los links) |
| `WHATSAPP_TOKEN` | Token permanente del paso 1.5 |
| `WHATSAPP_PHONE_NUMBER_ID` | Del paso 1.6 |
| `WHATSAPP_APP_SECRET` | App → Configuración → Básica → Clave secreta de la app |
| `WHATSAPP_VERIFY_TOKEN` | Inventalo vos (una frase larga cualquiera). Se repite en el paso 4 |
| `CRON_SECRET` | Inventalo vos. Se repite en el paso 5 |

Para probar sin mandar nada real: `WHATSAPP_MODE=console` imprime los mensajes en el log de Render.

## 4. Webhook (para saber si el mensaje llegó y se leyó)

App → WhatsApp → Configuración → Webhook:

- **URL de devolución de llamada:** `https://TU-API.onrender.com/webhooks/whatsapp`
- **Token de verificación:** el mismo `WHATSAPP_VERIFY_TOKEN`
- Suscribite al campo **messages**.

Sin webhook igual se manda todo; solo no vas a ver "Entregado" ni "Leído" en el panel.

## 5. Cron: que los recordatorios salgan a su hora

El servicio gratis de Render se duerme a los 15 minutos sin tráfico, así que algo de afuera tiene que despertarlo. Elegí **una** de estas dos opciones:

**Opción A — Render Cron Job (de pago, unos USD 1 por mes, la más simple)**
- New → Cron Job, en el mismo repositorio.
- Schedule: `*/10 * * * *` (cada 10 minutos).
- Build command: `npm install --omit=dev -w api`
- Command: `node api/scripts/run-reminders.js`
- Variables: `API_URL=https://TU-API.onrender.com` y `CRON_SECRET` (el mismo de la API).

**Opción B — pg_cron en Supabase (gratis)**

En Supabase → Database → Extensions, activá `pg_cron` y `pg_net`, y corré en el SQL Editor:

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

Con cualquiera de las dos, el recordatorio sale como mucho 10 minutos después de su hora. La confirmación y el aviso de cancelación no esperan al cron: salen apenas se reserva o se cancela.

## Cómo se comporta

- **Reintentos:** si Meta está caído o limita los envíos, se reintenta a los 5 y a los 10 minutos. Al tercer intento queda **Falló**.
- **Errores definitivos** (por ejemplo, el número no tiene WhatsApp, código 131026): fallan al primer intento.
- **No se manda:** cuando el cliente no tiene celular, cuando el turno ya se canceló o ya empezó, cuando se reservó con menos anticipación que el recordatorio, o cuando la confirmación tiene más de 6 horas de atraso.
- **Nunca doble:** cada turno tiene como mucho un mensaje de cada tipo, y dos crons a la vez no se pisan.
- **Celulares argentinos:** se guardan como `+549…`, que es como los acepta la Cloud API.
