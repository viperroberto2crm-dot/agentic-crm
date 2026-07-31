-- 2026-07-30 · Mensajes (SMS) con pacientes vía Twilio + consentimiento
-- ============================================================================
-- CONTEXTO: Fase 3a — el vendedor envía/recibe SMS con el paciente desde su
-- ficha. Los mensajes (salientes y entrantes) se guardan en `messages`. El
-- webhook /api/webhooks/twilio inserta los entrantes; la acción sendSms los
-- salientes. Se muestran como un hilo en la ficha (con Realtime).
--
-- Correr en: Supabase Dashboard → SQL Editor → Run. Aditivo (tabla + 2 columnas).
-- ============================================================================

create table if not exists messages (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null default 'twilio',
  brand_id     uuid references brands(id) on delete set null,
  lead_id      uuid references leads(id) on delete cascade,
  direction    text not null check (direction in ('in','out')),
  channel      text not null default 'sms',
  body         text,
  from_number  text,
  to_number    text,
  external_id  text,                 -- Twilio MessageSid
  status       text,
  raw          jsonb,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- Idempotencia del webhook por MessageSid. Índice ÚNICO PLANO (no parcial): con
-- WHERE, PostgREST no lo puede usar como árbitro del onConflict (error 42P10) y
-- fallarían TODOS los entrantes. Sin WHERE, los NULL son distintos por defecto en
-- un índice único → los salientes sin sid siguen insertando; los sid reales dedupean.
create unique index if not exists messages_provider_external_id_uniq
  on messages(provider, external_id);
create index if not exists messages_lead_id_idx  on messages(lead_id);
create index if not exists messages_brand_id_idx on messages(brand_id);

alter table messages enable row level security;
drop policy if exists "auth read messages"   on messages;
drop policy if exists "brand read messages"  on messages;
drop policy if exists "service all messages"  on messages;
-- Lectura ACOTADA por marca (SMS = contenido sensible de pacientes): un usuario
-- solo ve mensajes de las marcas donde es miembro (user_brands). Los entrantes sin
-- vincular (brand_id null) solo los ve el service_role. Realtime respeta esta RLS.
create policy "brand read messages" on messages for select to authenticated
  using (
    brand_id is not null and exists (
      select 1 from user_brands ub
      where ub.user_id = auth.uid() and ub.brand_id = messages.brand_id
    )
  );
create policy "service all messages" on messages for all to service_role using (true) with check (true);

-- Realtime para el hilo en vivo en la ficha (INSERTs). Si ya está en la
-- publicación, este ADD da error inofensivo — ignóralo.
alter publication supabase_realtime add table messages;

-- Consentimiento SMS en leads (STOP/START). sendSms respeta sms_opt_out.
alter table leads add column if not exists sms_opt_out    boolean not null default false;
alter table leads add column if not exists sms_opt_out_at timestamptz;

-- Verificación:
select exists (select 1 from information_schema.tables where table_name = 'messages') as tabla_creada;
