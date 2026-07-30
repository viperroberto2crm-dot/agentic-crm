-- 2026-07-30 · Tabla de credenciales de integraciones (cifradas)
-- ============================================================================
-- CONTEXTO: el hub de Integraciones (Configuración → Integraciones) permite a un
-- admin CONECTAR servicios pegando sus llaves desde el CRM. Las llaves se guardan
-- CIFRADAS (AES-256-GCM, src/lib/crypto/secrets.ts) en la columna `secrets`
-- (jsonb: { <fieldKey>: <blob base64 cifrado> }). La llave maestra vive SOLO en
-- Vercel env (CONNECTIONS_ENC_KEY), nunca aquí.
--
-- ⚠️ SEGURIDAD: a diferencia del resto de tablas del proyecto, esta NO lleva
-- policy de SELECT para `authenticated` — así NINGÚN usuario de sesión (rep,
-- provider, ni siquiera un admin vía el cliente de sesión) puede leer la columna
-- de secretos. Solo el `service_role` (usado por el server, con guard admin en el
-- código) puede leer/escribir. Aunque los valores están cifrados, esto es defensa
-- en profundidad.
--
-- Correr en: Supabase Dashboard → SQL Editor → Run. 100% aditivo (tabla nueva).
-- ============================================================================

create table if not exists connection_credentials (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null unique,          -- 'stripe' | 'square' | 'twilio' | ...
  secrets     jsonb not null default '{}'::jsonb,
  created_by  uuid references users(id) on delete set null,
  updated_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table connection_credentials enable row level security;

-- SOLO service_role. NO se crea policy para `authenticated` a propósito.
drop policy if exists "service all connection_credentials" on connection_credentials;
create policy "service all connection_credentials"
  on connection_credentials for all to service_role
  using (true) with check (true);

-- Verificación:
select exists (
  select 1 from information_schema.tables
  where table_name = 'connection_credentials'
) as tabla_creada;
