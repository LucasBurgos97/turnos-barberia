-- =====================================================================
-- DATOS DE EJEMPLO — no son de la barbería real.
-- Reemplazar nombre, barberos, servicios, precios y horarios por los reales
-- antes de lanzar. Los clientes usan celulares falsos (+549387000000x).
-- =====================================================================

-- Local
insert into public.shop_settings (id, name, address, maps_url, whatsapp_phone)
values (1, 'Barbería Ejemplo', 'Calle Ejemplo 123, Salta', null, null)
on conflict (id) do update set name = excluded.name, address = excluded.address;

-- Barberos (ids fijos para poder referenciarlos)
insert into public.barbers (id, name, sort_order) values
  ('00000000-0000-4000-8000-000000000b01', 'Nico (ejemplo)', 1),
  ('00000000-0000-4000-8000-000000000b02', 'Fede (ejemplo)', 2)
on conflict (id) do nothing;

-- Servicios (precios de ejemplo)
insert into public.services (id, name, duration_min, price_ars, sort_order) values
  ('00000000-0000-4000-8000-000000000501', 'Corte',            30, 10000, 1),
  ('00000000-0000-4000-8000-000000000502', 'Corte + barba',    45, 14000, 2),
  ('00000000-0000-4000-8000-000000000503', 'Barba',            20,  6000, 3),
  ('00000000-0000-4000-8000-000000000504', 'Corte niño',       30,  8000, 4)
on conflict (id) do nothing;

-- Nico hace todo; Fede no hace barba sola
insert into public.barber_services (barber_id, service_id)
select b, s from (values
  ('00000000-0000-4000-8000-000000000b01'::uuid, '00000000-0000-4000-8000-000000000501'::uuid),
  ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000502'),
  ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000503'),
  ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000504'),
  ('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000501'),
  ('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000502'),
  ('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000504')
) as t(b, s)
on conflict do nothing;

-- Horario cortado (siesta): martes a viernes 9–13 y 17–21, sábado 9–14
insert into public.working_hours (barber_id, weekday, start_time, end_time)
select b.id, d.weekday, t.start_time, t.end_time
from public.barbers b
cross join generate_series(2, 5) as d(weekday)
cross join (values (time '09:00', time '13:00'), (time '17:00', time '21:00')) as t(start_time, end_time)
where b.id in ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000b02')
  and not exists (select 1 from public.working_hours w where w.barber_id = b.id);

insert into public.working_hours (barber_id, weekday, start_time, end_time)
select b.id, 6, time '09:00', time '14:00'
from public.barbers b
where b.id in ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000b02')
  and not exists (select 1 from public.working_hours w where w.barber_id = b.id and w.weekday = 6);

-- Clientes de ejemplo (celulares falsos)
insert into public.customers (id, name, phone) values
  ('00000000-0000-4000-8000-0000000000c1', 'Juan Ejemplo',   '+5493870000001'),
  ('00000000-0000-4000-8000-0000000000c2', 'Matías Ejemplo', '+5493870000002'),
  ('00000000-0000-4000-8000-0000000000c3', 'Lucas Ejemplo',  '+5493870000003')
on conflict (id) do nothing;

-- Turnos de ejemplo para la agenda: mañana (hora de Salta), así siempre son futuros
with base as (
  select ((now() at time zone 'America/Argentina/Salta')::date + 1) as d
)
insert into public.appointments
  (barber_id, service_id, customer_id, starts_at, ends_at, service_name_snapshot, price_snapshot, source)
select v.barber_id, s.id, v.customer_id,
       (base.d + v.t) at time zone 'America/Argentina/Salta',
       (base.d + v.t) at time zone 'America/Argentina/Salta' + make_interval(mins => s.duration_min),
       s.name, s.price_ars, v.source::public.appointment_source
from base
cross join (values
  ('00000000-0000-4000-8000-000000000b01'::uuid, '00000000-0000-4000-8000-000000000501'::uuid, '00000000-0000-4000-8000-0000000000c1'::uuid, time '09:30', 'online'),
  ('00000000-0000-4000-8000-000000000b01',       '00000000-0000-4000-8000-000000000502',       '00000000-0000-4000-8000-0000000000c2',       time '17:30', 'online'),
  ('00000000-0000-4000-8000-000000000b02',       '00000000-0000-4000-8000-000000000501',       '00000000-0000-4000-8000-0000000000c3',       time '10:00', 'manual')
) as v(barber_id, service_id, customer_id, t, source)
join public.services s on s.id = v.service_id
where not exists (select 1 from public.appointments);

-- Los mensajes de los turnos de ejemplo NO deben salir nunca (celulares falsos)
update public.notifications n
   set status = 'skipped', error = 'datos de ejemplo'
  from public.appointments a
 where a.id = n.appointment_id
   and a.customer_id in ('00000000-0000-4000-8000-0000000000c1',
                         '00000000-0000-4000-8000-0000000000c2',
                         '00000000-0000-4000-8000-0000000000c3')
   and n.status = 'scheduled';
