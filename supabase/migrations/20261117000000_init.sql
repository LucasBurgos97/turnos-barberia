-- =====================================================================
-- Turnos Barbería — esquema inicial
-- Una sola barbería. El frontend NO accede directo: todo pasa por la API
-- (Express con service_role). RLS activado sin políticas = cerrado al
-- público como red de seguridad.
-- =====================================================================

create extension if not exists pgcrypto  with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.appointment_status as enum (
  'booked',                -- reservado / vigente
  'completed',             -- asistió
  'no_show',               -- no vino
  'cancelled_by_customer',
  'cancelled_by_shop'
);

create type public.appointment_source as enum ('online', 'manual');

create type public.notification_kind as enum ('confirmation', 'reminder', 'cancellation');

create type public.notification_status as enum (
  'scheduled', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped'
);

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- shop_settings (una sola fila, id = 1)
-- ---------------------------------------------------------------------
create table public.shop_settings (
  id                     smallint primary key default 1 check (id = 1),
  name                   text not null,
  logo_url               text,
  address                text,
  maps_url               text,
  whatsapp_phone         text check (whatsapp_phone ~ '^\+[1-9][0-9]{7,14}$'),
  timezone               text not null default 'America/Argentina/Salta',
  slot_step_min          int  not null default 15  check (slot_step_min between 5 and 120),
  booking_window_days    int  not null default 14  check (booking_window_days between 1 and 90),
  min_notice_min         int  not null default 60  check (min_notice_min >= 0),
  cancel_limit_hours     int  not null default 3   check (cancel_limit_hours >= 0),
  reminder_hours_before  int  not null default 3   check (reminder_hours_before between 1 and 72),
  updated_at             timestamptz not null default now()
);
create trigger shop_settings_updated_at before update on public.shop_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- admins: usuarios de Supabase Auth que pueden entrar a /admin
-- ---------------------------------------------------------------------
create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- barbers / services / barber_services
-- ---------------------------------------------------------------------
create table public.barbers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  photo_url   text,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger barbers_updated_at before update on public.barbers
  for each row execute function public.set_updated_at();

create table public.services (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) > 0),
  duration_min  int  not null check (duration_min between 5 and 480),
  price_ars     int  not null check (price_ars >= 0),
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger services_updated_at before update on public.services
  for each row execute function public.set_updated_at();

create table public.barber_services (
  barber_id   uuid not null references public.barbers (id)  on delete cascade,
  service_id  uuid not null references public.services (id) on delete cascade,
  primary key (barber_id, service_id)
);
create index barber_services_service_idx on public.barber_services (service_id);

-- ---------------------------------------------------------------------
-- working_hours: horario semanal, varios tramos por día (ej. siesta)
-- ---------------------------------------------------------------------
create table public.working_hours (
  id          uuid primary key default gen_random_uuid(),
  barber_id   uuid not null references public.barbers (id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),  -- 0 = domingo
  start_time  time not null,
  end_time    time not null,
  check (end_time > start_time),
  -- dos tramos del mismo barbero y día no pueden pisarse
  exclude using gist (
    barber_id with =,
    weekday   with =,
    tsrange(date '2000-01-01' + start_time, date '2000-01-01' + end_time, '[)') with &&
  )
);
create index working_hours_barber_idx on public.working_hours (barber_id, weekday);

-- ---------------------------------------------------------------------
-- time_off: vacaciones, feriados, imprevistos (barber_id null = todo el local)
-- ---------------------------------------------------------------------
create table public.time_off (
  id          uuid primary key default gen_random_uuid(),
  barber_id   uuid references public.barbers (id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index time_off_range_idx on public.time_off using gist (tstzrange(starts_at, ends_at, '[)'));

-- ---------------------------------------------------------------------
-- customers: sin cuenta, identificados por celular (E.164)
-- phone es opcional solo para turnos manuales de quien llega sin turno
-- ---------------------------------------------------------------------
create table public.customers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) > 0),
  phone          text unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  notes          text,
  no_show_count  int not null default 0 check (no_show_count >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------
create table public.appointments (
  id                     uuid primary key default gen_random_uuid(),
  number                 bigint generated always as identity unique,  -- "Nº 0142"
  barber_id              uuid not null references public.barbers (id)   on delete restrict,
  service_id             uuid not null references public.services (id)  on delete restrict,
  customer_id            uuid not null references public.customers (id) on delete restrict,
  starts_at              timestamptz not null,
  ends_at                timestamptz not null,
  status                 public.appointment_status not null default 'booked',
  source                 public.appointment_source not null default 'online',
  service_name_snapshot  text not null,
  price_snapshot         int  not null check (price_snapshot >= 0),
  cancel_token           text not null unique default
    rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '='),
  created_at             timestamptz not null default now(),
  cancelled_at           timestamptz,
  updated_at             timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((status in ('cancelled_by_customer', 'cancelled_by_shop')) = (cancelled_at is not null)),
  -- CLAVE: un barbero no puede tener dos turnos vigentes superpuestos.
  -- Si dos clientes reservan a la vez, el segundo insert falla (23P01) → API 409.
  constraint appointments_no_overlap exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'booked')
);
create trigger appointments_updated_at before update on public.appointments
  for each row execute function public.set_updated_at();

create index appointments_barber_start_idx on public.appointments (barber_id, starts_at);
create index appointments_start_idx        on public.appointments (starts_at);
create index appointments_customer_idx     on public.appointments (customer_id);

-- ---------------------------------------------------------------------
-- notifications: mensajes de WhatsApp
-- ---------------------------------------------------------------------
create table public.notifications (
  id                   uuid primary key default gen_random_uuid(),
  appointment_id       uuid not null references public.appointments (id) on delete cascade,
  kind                 public.notification_kind not null,
  status               public.notification_status not null default 'scheduled',
  scheduled_for        timestamptz not null,
  provider_message_id  text unique,
  attempts             int not null default 0 check (attempts >= 0),
  error                text,
  sent_at              timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (appointment_id, kind)   -- nunca dos recordatorios del mismo turno
);
create trigger notifications_updated_at before update on public.notifications
  for each row execute function public.set_updated_at();

-- lo que levanta el cron: "pendientes cuya hora ya llegó"
create index notifications_due_idx on public.notifications (scheduled_for)
  where status = 'scheduled';

-- ---------------------------------------------------------------------
-- Encolado automático de WhatsApp según el ciclo de vida del turno.
-- Vive en la base para que sea atómico con el insert/update del turno.
-- ---------------------------------------------------------------------
create or replace function public.enqueue_appointment_notifications()
returns trigger language plpgsql as $$
declare
  v_has_phone       boolean;
  v_reminder_hours  int;
  v_reminder_at     timestamptz;
begin
  select c.phone is not null into v_has_phone
    from public.customers c where c.id = new.customer_id;

  if tg_op = 'INSERT' and new.status = 'booked' then
    select reminder_hours_before into v_reminder_hours from public.shop_settings where id = 1;
    v_reminder_at := new.starts_at - make_interval(hours => coalesce(v_reminder_hours, 3));

    insert into public.notifications (appointment_id, kind, scheduled_for, status, error)
    values
      (new.id, 'confirmation', now(),
       case when v_has_phone then 'scheduled' else 'skipped' end::public.notification_status,
       case when v_has_phone then null else 'sin celular' end),
      (new.id, 'reminder', v_reminder_at,
       case when not v_has_phone then 'skipped'
            when v_reminder_at <= now() then 'skipped'
            else 'scheduled' end::public.notification_status,
       case when not v_has_phone then 'sin celular'
            when v_reminder_at <= now() then 'reservado con menos anticipación que el recordatorio'
            else null end);

  elsif tg_op = 'UPDATE' and old.status = 'booked' and new.status <> 'booked' then
    -- el turno dejó de estar vigente: lo que no salió, ya no sale
    update public.notifications
       set status = 'skipped', error = 'turno ' || new.status::text
     where appointment_id = new.id
       and status = 'scheduled';

    if new.status in ('cancelled_by_customer', 'cancelled_by_shop') and v_has_phone then
      insert into public.notifications (appointment_id, kind, scheduled_for)
      values (new.id, 'cancellation', now())
      on conflict (appointment_id, kind) do nothing;
    end if;
  end if;

  return new;
end $$;

create trigger appointments_enqueue_notifications
  after insert or update of status on public.appointments
  for each row execute function public.enqueue_appointment_notifications();

-- contador de faltas del cliente
create or replace function public.track_no_show()
returns trigger language plpgsql as $$
begin
  if new.status = 'no_show' and old.status is distinct from 'no_show' then
    update public.customers set no_show_count = no_show_count + 1 where id = new.customer_id;
  elsif old.status = 'no_show' and new.status <> 'no_show' then
    update public.customers set no_show_count = greatest(no_show_count - 1, 0) where id = new.customer_id;
  end if;
  return new;
end $$;

create trigger appointments_track_no_show
  after update of status on public.appointments
  for each row execute function public.track_no_show();

-- ---------------------------------------------------------------------
-- RLS: activado en todo, sin políticas → anon/authenticated no ven nada.
-- La API usa service_role, que saltea RLS.
-- ---------------------------------------------------------------------
alter table public.shop_settings    enable row level security;
alter table public.admins           enable row level security;
alter table public.barbers          enable row level security;
alter table public.services         enable row level security;
alter table public.barber_services  enable row level security;
alter table public.working_hours    enable row level security;
alter table public.time_off         enable row level security;
alter table public.customers        enable row level security;
alter table public.appointments     enable row level security;
alter table public.notifications    enable row level security;
