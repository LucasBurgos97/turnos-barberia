import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { ApiError } from './errors.js';
import { isValidDateStr } from './lib/time.js';
import {
  cancelByToken, createAppointment, getAvailability, getByToken, getShop,
} from './services/booking.js';
import { timingSafeEqual } from 'node:crypto';
import {
  createManualAppointment, getAdminAppointment, getAgenda, listNotifications, retryNotification, updateAppointmentStatus,
} from './services/admin.js';
import { requireAdmin } from './auth.js';
import { applyStatuses, verifySignature } from './whatsapp/webhook.js';
import {
  createTimeOff, deleteTimeOff, getAdminSettings, listBarbers, listServices, listTimeOff, reorder,
  saveBarber, saveService, updateSettings,
} from './services/config.js';

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

const uuid = z.string().uuid();
const optionalBarber = z.union([uuid, z.literal('any'), z.literal('')]).optional()
  .transform((v) => (v && v !== 'any' ? v : null));

const availabilityQuery = z.object({
  serviceId: uuid,
  barberId: optionalBarber,
  date: z.string().refine(isValidDateStr, 'Fecha inválida (YYYY-MM-DD)'),
});

const bookingBody = z.object({
  serviceId: uuid,
  barberId: optionalBarber.nullable(),
  startsAt: z.string().datetime({ offset: true }),
  name: z.string().trim().min(2, 'Poné tu nombre').max(60),
  phone: z.string().trim().min(6).max(30),
});

const dateParam = z.string().refine(isValidDateStr, 'Fecha inválida (YYYY-MM-DD)');

const manualBody = z.object({
  serviceId: uuid,
  barberId: uuid,
  startsAt: z.string().datetime({ offset: true }),
  name: z.string().trim().min(2, 'Poné el nombre').max(60),
  phone: z.string().trim().max(30).optional().nullable(),
});

const statusBody = z.object({
  status: z.enum(['booked', 'completed', 'no_show', 'cancelled_by_shop']),
});

const hhmmStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)');

const serviceBody = z.object({
  name: z.string().trim().min(2, 'Poné un nombre').max(60),
  durationMin: z.coerce.number().int().min(5, 'Mínimo 5 minutos').max(480),
  priceArs: z.coerce.number().int().min(0).max(10_000_000),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  barberIds: z.array(uuid).optional(),
});

const barberBody = z.object({
  name: z.string().trim().min(2, 'Poné un nombre').max(40),
  photoUrl: z.string().trim().url('URL inválida').max(500).nullable().optional().or(z.literal('').transform(() => null)),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  serviceIds: z.array(uuid).optional(),
  hours: z.array(z.object({ weekday: z.number().int().min(0).max(6), start: hhmmStr, end: hhmmStr })).max(28).optional(),
});

const timeOffBody = z.object({
  barberId: uuid.nullable().optional(),
  fromDate: dateParam,
  toDate: dateParam,
  fromTime: hhmmStr.optional().nullable(),
  toTime: hhmmStr.optional().nullable(),
  reason: z.string().trim().max(80).optional().nullable(),
});

const optionalUrl = z.string().trim().url('URL inválida').max(500).or(z.literal('')).nullable().optional();
const settingsBody = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  logoUrl: optionalUrl,
  address: z.string().trim().max(120).nullable().optional(),
  mapsUrl: optionalUrl,
  whatsappPhone: z.string().trim().max(30).nullable().optional(),
  slotStepMin: z.coerce.number().int().min(5).max(120).optional(),
  bookingWindowDays: z.coerce.number().int().min(1).max(90).optional(),
  minNoticeMin: z.coerce.number().int().min(0).max(24 * 60).optional(),
  cancelLimitHours: z.coerce.number().int().min(0).max(72).optional(),
  reminderHoursBefore: z.coerce.number().int().min(1).max(72).optional(),
});

const reorderBody = z.object({ ids: z.array(uuid).min(1) });

/**
 * @param {object} deps
 * @param {{query: Function, tx: Function}} deps.db
 * @param {() => Date} [deps.now]
 * @param {string[]} [deps.corsOrigins]  dominios del frontend (Vercel)
 * @param {string} [deps.defaultArea]    característica por defecto para celulares sin ella
 * @param {boolean} [deps.rateLimit]     false en tests
 * @param {(token: string) => Promise<{userId: string, email?: string}>} [deps.verifyToken]  JWT del dueño
 * @param {{ kick: Function, runOnce: Function }} [deps.notifier]  despacho de WhatsApp (sin esto, no se manda nada)
 * @param {string} [deps.cronSecret]      secreto del cron (/internal/reminders/run)
 * @param {{ verifyToken?: string, appSecret?: string }} [deps.webhook]  webhook de Meta
 */
export function createApp({
  db, now = () => new Date(), corsOrigins = [], defaultArea = '387', rateLimit: useRateLimit = true, verifyToken,
  notifier, cronSecret, webhook = {},
}) {
  const kick = () => { notifier?.kick(); };
  const app = express();
  app.set('trust proxy', 1); // Render está detrás de un proxy
  app.disable('x-powered-by');
  // rawBody: el webhook de Meta firma el cuerpo exacto que mandó
  app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use(cors({
    origin: corsOrigins.length ? corsOrigins : false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'authorization'],
  }));

  const bookingLimiter = useRateLimit
    ? rateLimit({
      windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
      handler: (_req, res) => res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Demasiados intentos. Esperá un minuto.' },
      }),
    })
    : (_req, _res, next) => next();

  // /health: liviano (lo usa Render). /health?db=1 además prueba la base (para el smoke test).
  app.get('/health', async (req, res) => {
    if (req.query.db === undefined) return res.json({ ok: true });
    try {
      await db.query('select 1 from shop_settings where id = 1');
      return res.json({ ok: true, db: true, whatsapp: Boolean(notifier), adminAuth: Boolean(verifyToken) });
    } catch {
      return res.status(503).json({ ok: false, db: false });
    }
  });

  app.get('/api/shop', async (_req, res) => {
    res.json(await getShop(db));
  });

  app.get('/api/availability', async (req, res) => {
    const q = availabilityQuery.parse(req.query);
    res.json(await getAvailability(db, q, now()));
  });

  app.post('/api/appointments', bookingLimiter, async (req, res) => {
    const body = bookingBody.parse(req.body);
    res.status(201).json(await createAppointment(db, body, now(), { defaultArea }));
    kick();
  });

  app.get('/api/appointments/by-token/:token', async (req, res) => {
    res.json(await getByToken(db, req.params.token, now()));
  });

  app.post('/api/appointments/by-token/:token/cancel', bookingLimiter, async (req, res) => {
    res.json(await cancelByToken(db, req.params.token, now()));
    kick();
  });

  // ---------------------------------------------------------------- WhatsApp
  // Cron (Render Cron Job o pg_cron): manda lo que ya tiene que salir
  app.post('/internal/reminders/run', async (req, res) => {
    if (!cronSecret || !safeEqual(req.get('x-cron-secret'), cronSecret)) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Secreto inválido.');
    }
    if (!notifier) throw new ApiError(503, 'WHATSAPP_DISABLED', 'WhatsApp no está configurado.');
    res.json(await notifier.runOnce());
  });

  // Verificación del webhook (Meta → WhatsApp → Configuración → Webhook)
  app.get('/webhooks/whatsapp', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && webhook.verifyToken
      && safeEqual(req.query['hub.verify_token'], webhook.verifyToken)) {
      return res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
    }
    return res.sendStatus(403);
  });

  // Estados de entrega (enviado / entregado / leído / falló)
  app.post('/webhooks/whatsapp', async (req, res) => {
    if (!verifySignature(req.rawBody, req.get('x-hub-signature-256'), webhook.appSecret)) {
      return res.sendStatus(401);
    }
    await applyStatuses(db, req.body);
    return res.sendStatus(200);
  });

  // ---------------------------------------------------------------- Panel del dueño
  const admin = express.Router();
  admin.use(requireAdmin({ db, verifyToken }));

  admin.get('/me', (req, res) => res.json({ email: req.admin.email ?? null }));

  admin.get('/agenda', async (req, res) => {
    res.json(await getAgenda(db, dateParam.parse(req.query.date), now()));
  });

  admin.get('/availability', async (req, res) => {
    const q = availabilityQuery.parse(req.query);
    res.json(await getAvailability(db, q, now(), { ignoreNotice: true }));
  });

  admin.get('/appointments/:id', async (req, res) => {
    res.json(await getAdminAppointment(db, uuid.parse(req.params.id)));
  });

  admin.patch('/appointments/:id', async (req, res) => {
    const { status } = statusBody.parse(req.body);
    res.json(await updateAppointmentStatus(db, uuid.parse(req.params.id), status, now()));
    kick();
  });

  admin.post('/appointments', async (req, res) => {
    res.status(201).json(await createManualAppointment(db, manualBody.parse(req.body), now(), { defaultArea }));
    kick();
  });

  admin.get('/notifications', async (req, res) => {
    const filter = z.enum(['all', 'pending', 'sent', 'failed']).default('all').parse(req.query.filter);
    res.json({ ...(await listNotifications(db, { filter })), whatsappEnabled: Boolean(notifier) });
  });

  admin.post('/notifications/:id/retry', async (req, res) => {
    res.json(await retryNotification(db, uuid.parse(req.params.id), now()));
    kick();
  });

  // Configuración: servicios, barberos, bloqueos y ajustes
  admin.get('/services', async (_req, res) => res.json(await listServices(db)));
  admin.post('/services', async (req, res) => res.status(201).json(await saveService(db, null, serviceBody.parse(req.body))));
  admin.patch('/services/:id', async (req, res) => {
    res.json(await saveService(db, uuid.parse(req.params.id), serviceBody.partial().parse(req.body)));
  });
  admin.post('/services/reorder', async (req, res) => {
    await reorder(db, 'services', reorderBody.parse(req.body).ids);
    res.json(await listServices(db));
  });

  admin.get('/barbers', async (_req, res) => res.json(await listBarbers(db)));
  admin.post('/barbers', async (req, res) => res.status(201).json(await saveBarber(db, null, barberBody.parse(req.body))));
  admin.patch('/barbers/:id', async (req, res) => {
    res.json(await saveBarber(db, uuid.parse(req.params.id), barberBody.partial().parse(req.body)));
  });
  admin.post('/barbers/reorder', async (req, res) => {
    await reorder(db, 'barbers', reorderBody.parse(req.body).ids);
    res.json(await listBarbers(db));
  });

  admin.get('/time-off', async (_req, res) => res.json(await listTimeOff(db, now())));
  admin.post('/time-off', async (req, res) => res.status(201).json(await createTimeOff(db, timeOffBody.parse(req.body))));
  admin.delete('/time-off/:id', async (req, res) => res.json(await deleteTimeOff(db, uuid.parse(req.params.id))));

  admin.get('/settings', async (_req, res) => res.json(await getAdminSettings(db)));
  admin.patch('/settings', async (req, res) => {
    res.json(await updateSettings(db, settingsBody.parse(req.body), { defaultArea }));
  });

  app.use('/api/admin', admin);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta inexistente.' } });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
    }
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Hay datos inválidos.',
          fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'JSON inválido.' } });
    }
    console.error(err);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Algo falló. Probá de nuevo.' } });
  });

  return app;
}
