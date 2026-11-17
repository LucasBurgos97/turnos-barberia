-- Imita lo mínimo de Supabase para probar en un Postgres pelado.
create schema if not exists extensions;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
alter database postgres set search_path = public, extensions;
set search_path = public, extensions;
