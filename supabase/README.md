# Base de datos (Supabase)

| Archivo | Qué es |
|---|---|
| `migrations/20261117000000_init.sql` | Esquema completo: tablas, enums, anti turno doble, triggers de WhatsApp, RLS |
| `seed.sql` | **Datos de ejemplo** (barbería, 2 barberos, 4 servicios, horario cortado, 3 turnos para mañana). No son reales. |
| `tests/schema_test.sql` | Pruebas del esquema (turno doble, cancelación, recordatorios). Se corre en local con Docker. |

## Cargarlo en Supabase (sin instalar nada)

1. Creá el proyecto en [supabase.com](https://supabase.com). Elegí la región **South America (São Paulo)**.
2. Andá a **SQL Editor** → New query, pegá todo `migrations/20261117000000_init.sql` y tocá **Run**.
3. Hacé lo mismo con `seed.sql` si querés datos de prueba.
4. Creá el usuario del dueño en **Authentication → Users → Add user** (email + contraseña, con "Auto Confirm User" tildado).
5. Habilitalo como admin desde el SQL Editor:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'EMAIL_DEL_DUEÑO';
```

6. En **Project Settings → API**, copiá la `Project URL` y la `service_role` key. Van **solo** en el `.env` de la API (Render), nunca en el frontend.

## Con Supabase CLI (opcional)

```bash
npx supabase link --project-ref TU_PROJECT_REF
```

```bash
npx supabase db push
```

## Correr las pruebas en local (Docker)

```bash
sh supabase/tests/run.sh
```

## Cosas que hace la base sola

- **Anti turno doble:** `appointments_no_overlap` rechaza un turno vigente que se pise con otro del mismo barbero. Error `23P01`, que la API traduce a `409`.
- **WhatsApp:** al crear un turno se encolan la *confirmación* (ahora) y el *recordatorio* (`reminder_hours_before` antes). Si el turno se reservó con menos anticipación que el recordatorio, este queda `skipped`. Al cancelar, el recordatorio pendiente pasa a `skipped` y se encola el aviso de *cancelación*.
- **Faltas:** marcar un turno `no_show` suma 1 a `customers.no_show_count`, y desmarcarlo resta 1.
- **Nº de turno:** `appointments.number` es correlativo y se muestra con `lpad` como `Nº 0142`.
- **Link de cancelación:** `cancel_token` se genera solo (32 caracteres, seguro para URL).
