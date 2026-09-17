-- 2026-09-17 · Puente WhatsApp → Valeria (Fase 1)
-- ============================================================================
-- CONTEXTO: un anuncio Click-to-WhatsApp cae en el webhook que ya existe. Un bot
-- de texto saca nombre, necesidad y el PERMISO para llamar; guarda el permiso; y
-- dispara la llamada saliente de Valeria (Retell), que es quien agenda y cobra.
--
-- Esto agrega SOLO el estado que ese puente necesita. Es 100% aditivo e
-- idempotente: no borra nada, no toca RLS existente, y correrlo dos veces no
-- hace daño.
--
-- ⚠ PRECONDICIÓN: hay que haber corrido `docs/sql/2026-08-25-whatsapp.sql`
--   (pendiente desde agosto). Sin `leads.wa_opt_out` ni
--   `brands.whatsapp_phone_number_id`, el envío de WhatsApp no funciona. La
--   query de verificación del final lo comprueba.
--
-- Correr en: Supabase Dashboard → SQL Editor → Run.
-- ============================================================================


-- ── 1) EL INTERRUPTOR, por marca y en la BASE ───────────────────────────────
--
-- POR QUÉ en la base y no en un env var: el webhook de Meta es UNO SOLO para
-- todos los números de la app. Un flag global prendería el bot también en el
-- +1 562-298-3012, que lo contesta una PERSONA (es a donde transfiere Valeria).
-- Además, apagar un env var en Vercel exige redeploy + alias manual: 5-10
-- minutos con el bot portándose mal. Esto se apaga en el siguiente mensaje.
--
-- Modos:
--   off       → el bot no hace nada (DEFAULT: fail-closed).
--   shadow    → genera la respuesta y la guarda en `messages` con
--               status='dry_run', pero NO la manda ni llama. Sirve para leer lo
--               que HABRÍA contestado, desde la bandeja.
--   allowlist → envía de verdad, pero solo a los teléfonos de la lista.
--   on        → producción.
alter table brands add column if not exists whatsapp_bot_mode text not null default 'off';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'brands_whatsapp_bot_mode_chk'
  ) then
    alter table brands add constraint brands_whatsapp_bot_mode_chk
      check (whatsapp_bot_mode in ('off','shadow','allowlist','on'));
  end if;
end $$;

-- Teléfonos E.164 para el modo allowlist (pruebas con tu propio celular).
alter table brands add column if not exists whatsapp_bot_allowlist text[] not null default '{}';


-- ── 2) IDEMPOTENCIA DEL BOT ─────────────────────────────────────────────────
--
-- El upsert del webhook es idempotente para la FILA, pero no le dice al llamador
-- si fue un INSERT nuevo o un reintento de Meta. Sin esto, un reintento hace que
-- el bot conteste dos veces.
--
-- El claim es un UPDATE condicional (atómico en Postgres):
--   UPDATE messages SET bot_state='claimed', bot_claimed_at=now()
--   WHERE provider='whatsapp' AND external_id=$wamid AND bot_state IS NULL
--   RETURNING id;
-- Si devuelve 0 filas, otro ya lo tomó. Cero tablas nuevas y sin tocar el upsert
-- del hot-path.
alter table messages add column if not exists bot_state      text;
alter table messages add column if not exists bot_claimed_at timestamptz;


-- ── 3) ESTADO DE LA CONVERSACIÓN (y su candado) ─────────────────────────────
--
-- Una fila por (marca, teléfono). Guarda lo que el bot lleva recabado, cuántos
-- turnos van (techo de costo) y en qué punto va el disparo de la llamada.
create table if not exists whatsapp_bot_conversations (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  phone_e164   text not null,
  lead_id      uuid references leads(id) on delete set null,

  -- Techo de turnos: corta bucles con auto-respuestas ("mensaje de ausencia" de
  -- WhatsApp Business) y pone un máximo al gasto de Claude por persona.
  turns        int  not null default 0,

  -- Lo que el bot recabó: nombre, qué necesita, horario preferido, y el número
  -- al que pidió que le llamen (puede NO ser el mismo de WhatsApp).
  collected    jsonb not null default '{}'::jsonb,

  -- Máquina de estados del disparo. 'dispatching' es el segundo claim atómico:
  -- Retell create-phone-call NO tiene idempotency key, así que sin esto dos
  -- ejecuciones en carrera le llaman DOS VECES al paciente.
  call_state   text not null default 'none',
  retell_call_id text,

  -- Candado de conversación. Si llegan 5 mensajes seguidos, cada uno es una
  -- invocación distinta del webhook: sin candado son 5 Claudes en paralelo
  -- contestando lo mismo. El que gana el candado procesa TODOS los pendientes.
  lock_until   timestamptz,
  last_wamid   text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wa_bot_conv_call_state_chk'
  ) then
    alter table whatsapp_bot_conversations add constraint wa_bot_conv_call_state_chk
      check (call_state in ('none','consented','dispatching','dispatched','failed'));
  end if;
end $$;

-- Una sola conversación por marca+teléfono. Es también el candado optimista:
-- el insert-or-conflict evita dos filas en carrera.
create unique index if not exists wa_bot_conv_brand_phone_uniq
  on whatsapp_bot_conversations(brand_id, phone_e164);
create index if not exists wa_bot_conv_lead_idx on whatsapp_bot_conversations(lead_id);


-- ── 4) BITÁCORA DE CONSENTIMIENTO (lo que respalda la llamada) ──────────────
--
-- Esto es lo que hace defendible llamar a un celular con una voz de IA. NO basta
-- un booleano: hay que poder mostrar QUÉ se preguntó, QUÉ contestó y CUÁNDO.
--
-- Por eso se guardan los `wamid` de AMBOS lados: sin el id del mensaje de Meta,
-- la bitácora es texto que cualquiera pudo escribir después. Con el wamid, cada
-- lado es verificable contra la fila de `messages` y contra Meta.
--
-- `phone_e164` es el número al que se AUTORIZÓ llamar, que puede NO ser el de
-- WhatsApp (WhatsApp Business en línea fija, teléfono de un familiar).
create table if not exists call_consents (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references brands(id) on delete cascade,
  lead_id        uuid references leads(id) on delete set null,
  phone_e164     text not null,
  channel        text not null default 'whatsapp',

  -- Texto EXACTO de la pregunta. Va fijo en el código, no lo escribe el modelo:
  -- el consentimiento previo por escrito exige divulgar que la llamada es de un
  -- asistente automatizado, a qué número, y que aceptar no condiciona la compra.
  prompt_text    text not null,
  prompt_wamid   text,

  -- Texto EXACTO de la respuesta del paciente, tal como la escribió.
  response_text  text not null,
  response_wamid text,

  consented_at   timestamptz not null default now(),
  -- Revocación (STOP/BAJA después de haber dicho que sí). No se borra la fila:
  -- la evidencia de que hubo consentimiento tiene que sobrevivir a su retiro.
  revoked_at     timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists call_consents_lead_idx  on call_consents(lead_id);
create index if not exists call_consents_phone_idx on call_consents(phone_e164);
-- El consentimiento vigente de un número: el más reciente sin revocar.
create index if not exists call_consents_vigente_idx
  on call_consents(phone_e164, consented_at desc)
  where revoked_at is null;


-- ── 5) BITÁCORA DE LLAMADAS SALIENTES (incluye las que dispara un humano) ────
--
-- El botón "llamar" de la ficha hoy dispara a Retell SIN consentimiento guardado.
-- No se bloquea (rompería algo vivo), pero queda registrado quién lo disparó y
-- si había consentimiento o no. Es lo que le permite a Horizon decidir con datos
-- en la mano en vez de con una suposición.
create table if not exists outbound_call_attempts (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references brands(id) on delete cascade,
  lead_id        uuid references leads(id) on delete set null,
  phone_e164     text not null,
  -- 'human' = botón de la ficha · 'bot' = puente de WhatsApp
  source         text not null,
  actor_user_id  uuid references users(id) on delete set null,
  -- null en una llamada humana = se llamó SIN consentimiento guardado.
  consent_id     uuid references call_consents(id) on delete set null,
  retell_call_id text,
  outcome        text,
  created_at     timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'outbound_call_attempts_source_chk'
  ) then
    alter table outbound_call_attempts add constraint outbound_call_attempts_source_chk
      check (source in ('human','bot'));
  end if;
end $$;

create index if not exists outbound_call_attempts_lead_idx on outbound_call_attempts(lead_id);
create index if not exists outbound_call_attempts_sin_consent_idx
  on outbound_call_attempts(created_at desc)
  where consent_id is null;


-- ── 6) DE QUÉ ANUNCIO VINO, Y A QUÉ HORA QUIERE QUE LE LLAMEN ───────────────
--
-- `ad_ref` guarda crudo el `referral` de Meta (ctwa_clid, source_id, headline).
-- Crudo a propósito: normalizarlo no sirve de nada hasta que se quiera mandar
-- conversiones de vuelta a Meta con el ctwa_clid.
alter table leads add column if not exists ad_ref jsonb;

-- Fase 1 NO agenda la llamada diferida (los crons frecuentes dependen de
-- cron-job.org, externo y sin versionar). El bot guarda lo que el paciente pidió
-- y la ficha lo muestra para que un humano marque.
alter table leads add column if not exists callback_pref text;


-- ── 7) RLS ──────────────────────────────────────────────────────────────────
--
-- Mismo criterio que `messages` (2026-07-30): contenido sensible de pacientes →
-- lectura ACOTADA a las marcas donde el usuario es miembro; escritura solo
-- service_role. NO se toca ninguna policy existente.
alter table whatsapp_bot_conversations enable row level security;
alter table call_consents              enable row level security;
alter table outbound_call_attempts     enable row level security;

drop policy if exists "brand read wa bot conv" on whatsapp_bot_conversations;
create policy "brand read wa bot conv" on whatsapp_bot_conversations for select to authenticated
  using (exists (select 1 from user_brands ub
                 where ub.user_id = auth.uid() and ub.brand_id = whatsapp_bot_conversations.brand_id));
drop policy if exists "service all wa bot conv" on whatsapp_bot_conversations;
create policy "service all wa bot conv" on whatsapp_bot_conversations for all to service_role
  using (true) with check (true);

drop policy if exists "brand read consents" on call_consents;
create policy "brand read consents" on call_consents for select to authenticated
  using (exists (select 1 from user_brands ub
                 where ub.user_id = auth.uid() and ub.brand_id = call_consents.brand_id));
drop policy if exists "service all consents" on call_consents;
create policy "service all consents" on call_consents for all to service_role
  using (true) with check (true);

drop policy if exists "brand read call attempts" on outbound_call_attempts;
create policy "brand read call attempts" on outbound_call_attempts for select to authenticated
  using (exists (select 1 from user_brands ub
                 where ub.user_id = auth.uid() and ub.brand_id = outbound_call_attempts.brand_id));
drop policy if exists "service all call attempts" on outbound_call_attempts;
create policy "service all call attempts" on outbound_call_attempts for all to service_role
  using (true) with check (true);


-- ── VERIFICACIÓN ────────────────────────────────────────────────────────────
-- Las 8 primeras columnas deben decir 1. La última lista las marcas y en qué
-- modo quedó su bot: TODAS deben decir 'off' — el bot se prende a mano, marca
-- por marca, y solo después de la prueba con tu celular.
select
  (select count(*) from information_schema.columns
     where table_name='leads'    and column_name='wa_opt_out')                as pre_agosto_wa_opt_out,
  (select count(*) from information_schema.columns
     where table_name='brands'   and column_name='whatsapp_phone_number_id')  as pre_agosto_wa_phone_id,
  (select count(*) from information_schema.columns
     where table_name='brands'   and column_name='whatsapp_bot_mode')         as ok_interruptor,
  (select count(*) from information_schema.columns
     where table_name='messages' and column_name='bot_state')                 as ok_claim,
  (select count(*) from information_schema.tables
     where table_name='whatsapp_bot_conversations')                           as ok_conversaciones,
  (select count(*) from information_schema.tables
     where table_name='call_consents')                                        as ok_consentimientos,
  (select count(*) from information_schema.tables
     where table_name='outbound_call_attempts')                               as ok_bitacora_llamadas,
  (select count(*) from information_schema.columns
     where table_name='leads'    and column_name='ad_ref')                    as ok_ad_ref,
  (select string_agg(name || '=' || whatsapp_bot_mode, ', ' order by name)
     from brands where active)                                                as modo_del_bot_por_marca;
