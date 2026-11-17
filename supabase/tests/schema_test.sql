-- Pruebas del esquema. Cada bloque falla con un error si algo no se cumple.
\set ON_ERROR_STOP on
set search_path = public, extensions;

-- 1. El seed cargó lo esperado
do $$ begin
  assert (select count(*) from barbers) = 2, 'barberos';
  assert (select count(*) from services) = 4, 'servicios';
  assert (select count(*) from working_hours) = 18, 'tramos horarios (2 x (4x2 + 1))';
  assert (select count(*) from appointments) = 3, 'turnos de ejemplo';
  assert (select count(*) from notifications where status = 'scheduled') = 0,
         'los turnos de ejemplo no deben mandar WhatsApp';
end $$;

-- 2. Turno doble: mismo barbero, horario que se pisa → 23P01
do $$
declare d date := (now() at time zone 'America/Argentina/Salta')::date + 1;
begin
  begin
    insert into appointments (barber_id, service_id, customer_id, starts_at, ends_at, service_name_snapshot, price_snapshot)
    values ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000501',
            '00000000-0000-4000-8000-0000000000c3',
            (d + time '09:45') at time zone 'America/Argentina/Salta',
            (d + time '10:15') at time zone 'America/Argentina/Salta', 'Corte', 10000);
    raise exception 'FALLA: se permitió un turno superpuesto';
  exception when exclusion_violation then null;
  end;
end $$;

-- 3. Turno pegado (termina 10:00, empieza 10:00) sí se permite; otro barbero en el mismo horario también
do $$
declare d date := (now() at time zone 'America/Argentina/Salta')::date + 1;
begin
  insert into appointments (barber_id, service_id, customer_id, starts_at, ends_at, service_name_snapshot, price_snapshot)
  values ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000501',
          '00000000-0000-4000-8000-0000000000c3',
          (d + time '10:00') at time zone 'America/Argentina/Salta',
          (d + time '10:30') at time zone 'America/Argentina/Salta', 'Corte', 10000);
  insert into appointments (barber_id, service_id, customer_id, starts_at, ends_at, service_name_snapshot, price_snapshot)
  values ('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000501',
          '00000000-0000-4000-8000-0000000000c1',
          (d + time '09:30') at time zone 'America/Argentina/Salta',
          (d + time '10:00') at time zone 'America/Argentina/Salta', 'Corte', 10000);
end $$;

-- 4. Turno nuevo real → confirmación + recordatorio encolados, token generado
do $$
declare
  d date := (now() at time zone 'America/Argentina/Salta')::date + 2;
  v_cust uuid; v_appt uuid; v_token text;
begin
  insert into customers (name, phone) values ('Cliente Prueba', '+5493871234567') returning id into v_cust;
  insert into appointments (barber_id, service_id, customer_id, starts_at, ends_at, service_name_snapshot, price_snapshot)
  values ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000502', v_cust,
          (d + time '18:00') at time zone 'America/Argentina/Salta',
          (d + time '18:45') at time zone 'America/Argentina/Salta', 'Corte + barba', 14000)
  returning id, cancel_token into v_appt, v_token;

  assert length(v_token) = 32 and v_token ~ '^[A-Za-z0-9_-]+$', 'token seguro para URL';
  assert (select count(*) from notifications where appointment_id = v_appt and status = 'scheduled') = 2,
         'confirmación + recordatorio';
  assert (select scheduled_for from notifications where appointment_id = v_appt and kind = 'reminder')
         = ((d + time '15:00') at time zone 'America/Argentina/Salta'), 'recordatorio 3 h antes';

  -- 5. Cancelar → recordatorio skipped, aviso de cancelación encolado, horario liberado
  update appointments set status = 'cancelled_by_customer', cancelled_at = now() where id = v_appt;
  assert (select status from notifications where appointment_id = v_appt and kind = 'reminder') = 'skipped',
         'recordatorio cancelado';
  assert (select status from notifications where appointment_id = v_appt and kind = 'cancellation') = 'scheduled',
         'aviso de cancelación';
  insert into appointments (barber_id, service_id, customer_id, starts_at, ends_at, service_name_snapshot, price_snapshot)
  values ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000502', v_cust,
          (d + time '18:00') at time zone 'America/Argentina/Salta',
          (d + time '18:45') at time zone 'America/Argentina/Salta', 'Corte + barba', 14000);
end $$;

-- 6. Reserva con menos anticipación que el recordatorio → recordatorio skipped
do $$
declare v_appt uuid;
begin
  insert into appointments (barber_id, service_id, customer_id, starts_at, ends_at, service_name_snapshot, price_snapshot)
  values ('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000501',
          (select id from customers where phone = '+5493871234567'),
          now() + interval '1 hour', now() + interval '90 minutes', 'Corte', 10000)
  returning id into v_appt;
  assert (select status from notifications where appointment_id = v_appt and kind = 'reminder') = 'skipped',
         'recordatorio que ya pasó';
  assert (select status from notifications where appointment_id = v_appt and kind = 'confirmation') = 'scheduled',
         'la confirmación sí sale';
end $$;

-- 7. Cliente sin celular (turno manual) → nada se encola
do $$
declare v_cust uuid; v_appt uuid;
begin
  insert into customers (name) values ('Sin Celular') returning id into v_cust;
  insert into appointments (barber_id, service_id, customer_id, starts_at, ends_at, service_name_snapshot, price_snapshot, source)
  values ('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000504', v_cust,
          now() + interval '3 days', now() + interval '3 days 30 minutes', 'Corte niño', 8000, 'manual')
  returning id into v_appt;
  assert (select count(*) from notifications where appointment_id = v_appt and status = 'skipped') = 2,
         'sin celular → skipped';
end $$;

-- 8. Faltas: no_show suma, revertir resta
do $$
declare v_appt uuid := (select id from appointments where customer_id = '00000000-0000-4000-8000-0000000000c2' limit 1);
begin
  update appointments set status = 'no_show' where id = v_appt;
  assert (select no_show_count from customers where id = '00000000-0000-4000-8000-0000000000c2') = 1, 'falta +1';
  update appointments set status = 'completed' where id = v_appt;
  assert (select no_show_count from customers where id = '00000000-0000-4000-8000-0000000000c2') = 0, 'falta -1';
end $$;

-- 9. Validaciones: celular mal formado, cancelado sin fecha, tramos horarios pisados
do $$ begin
  begin insert into customers (name, phone) values ('X', '387 1234567');
        raise exception 'FALLA: aceptó celular sin E.164';
  exception when check_violation then null; end;

  begin update appointments set status = 'cancelled_by_shop'
         where id = (select id from appointments where status = 'booked' limit 1);
        raise exception 'FALLA: cancelado sin cancelled_at';
  exception when check_violation then null; end;

  begin insert into working_hours (barber_id, weekday, start_time, end_time)
        values ('00000000-0000-4000-8000-000000000b01', 2, '12:00', '14:00');
        raise exception 'FALLA: aceptó tramos superpuestos';
  exception when exclusion_violation then null; end;
end $$;

-- 10. RLS activado en todas las tablas
do $$ begin
  assert (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) = 0,
         'hay tablas sin RLS';
end $$;

select 'OK: todas las pruebas pasaron' as resultado;
