-- 2026-09-17 · Alertas al equipo (correo) cuando pasa algo en el CRM
-- ============================================================================
-- CONTEXTO: Roberto quiere enterarse en el momento de cada cita y cada pago.
-- Las tablas `notifications` / `notification_prefs` que ya existen son para
-- avisos DENTRO del CRM a usuarios con cuenta (`user_id` es NOT NULL), así que
-- no sirven para mandarle un correo a alguien que no es usuario del sistema.
--
-- Se manda por CORREO (Resend) y no por SMS porque la campaña A2P 10DLC de
-- Twilio sigue rechazada y los carriers bloquean el tráfico 10DLC sin registrar.
-- Por eso `channel` existe desde el día uno: cuando el A2P pase, prender SMS es
-- cambiar un valor, no rehacer la tabla.
--
-- Correr en: Supabase Dashboard → SQL Editor → Run. 100% aditivo e idempotente.
-- ============================================================================

-- 1) A quién se le avisa.
--    `brand_ids` vacío = todas las marcas (así queda el número/correo de Roberto).
--    `events` es un arreglo para que agregar un evento nuevo NO sea un ALTER.
create table if not exists alert_recipients (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  channel     text not null default 'email' check (channel in ('email', 'sms', 'whatsapp')),
  email       text,
  phone       text,
  brand_ids   uuid[] not null default '{}',
  events      text[] not null default '{}',
  active      boolean not null default true,
  -- Si el destinatario también es usuario del CRM se enlaza; si no, queda NULL.
  user_id     uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Un destinatario de correo necesita correo; uno de SMS/WhatsApp, teléfono.
  constraint alert_recipients_destino_check check (
    (channel = 'email' and email is not null and email <> '') or
    (channel in ('sms', 'whatsapp') and phone is not null and phone <> '')
  )
);

create index if not exists alert_recipients_active_idx on alert_recipients(active) where active;

-- 2) Bitácora de cada envío. Hace tres trabajos:
--    a) DEDUPE — `dedupe_key` único por destinatario. Si Retell reintenta la
--       herramienta y se agenda dos veces, el segundo correo no sale.
--    b) TOPE — se cuentan los envíos de la última hora para no inundar a nadie.
--    c) AUDITORÍA — qué se mandó, a quién y si falló.
create table if not exists alert_log (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid references alert_recipients(id) on delete set null,
  event         text not null,
  dedupe_key    text not null,
  channel       text not null,
  destination   text not null,
  status        text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'skipped')),
  error         text,
  created_at    timestamptz not null default now()
);

create unique index if not exists alert_log_dedupe_idx on alert_log(recipient_id, dedupe_key);
create index if not exists alert_log_recipient_created_idx on alert_log(recipient_id, created_at desc);

-- 3) RLS. Los envíos los hace el service_role (bypassa RLS). Desde la sesión,
--    solo admin/manager pueden ver y administrar; nadie más toca esto.
alter table alert_recipients enable row level security;
alter table alert_log        enable row level security;

drop policy if exists "admin manage alert_recipients" on alert_recipients;
create policy "admin manage alert_recipients" on alert_recipients
  for all to authenticated
  using      (exists (select 1 from users u where u.id = auth.uid() and u.role in ('admin', 'manager')))
  with check (exists (select 1 from users u where u.id = auth.uid() and u.role in ('admin', 'manager')));

drop policy if exists "admin read alert_log" on alert_log;
create policy "admin read alert_log" on alert_log
  for select to authenticated
  using (exists (select 1 from users u where u.id = auth.uid() and u.role in ('admin', 'manager')));

-- 4) Primer destinatario: Roberto, todas las marcas, todos los eventos.
--    ⚠️ CAMBIA el correo antes de correr esto si quieres otro.
insert into alert_recipients (label, channel, email, phone, brand_ids, events, active)
select 'Roberto', 'email', 'viperroberto@gmail.com', '+15622983012', '{}',
       array['appointment_set', 'appointment_cancelled', 'sale_paid', 'new_lead'], true
where not exists (select 1 from alert_recipients where email = 'viperroberto@gmail.com');

-- Verificación:
select id, label, channel, email, phone, events, brand_ids, active from alert_recipients order by created_at;
