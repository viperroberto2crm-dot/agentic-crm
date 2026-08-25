-- 2026-08-25 · WhatsApp (Meta Cloud API) sobre los rieles del SMS
-- ============================================================================
-- CONTEXTO: el CRM ya guarda SMS en `messages` (provider 'twilio', channel 'sms').
-- WhatsApp entra como UN CANAL MÁS de la misma tabla: provider 'whatsapp',
-- channel 'whatsapp', external_id = wamid de Meta. No hay tabla nueva.
--
-- Esto agrega solo lo que falta:
--   1) Consentimiento propio de WhatsApp (Meta exige honrar el opt-out y es
--      independiente del STOP de SMS: son canales distintos).
--   2) Remitente por marca (phone_number_id). Hoy hay UN número; si mañana cada
--      clínica tiene el suyo, se llena esta columna y el envío lo respeta.
--      Null → usa el phone_number_id global de Configuración → Integraciones.
--   3) Índice por canal (el hilo de la ficha filtra por channel).
--
-- Correr en: Supabase Dashboard → SQL Editor → Run. 100% aditivo e idempotente.
-- ============================================================================

-- 1) Consentimiento WhatsApp (separado del de SMS).
alter table leads add column if not exists wa_opt_out    boolean not null default false;
alter table leads add column if not exists wa_opt_out_at timestamptz;

-- 2) Remitente de WhatsApp por marca. `brands.whatsapp_number` (ya existente) es
--    el número visible; este es el ID que Meta pide para ENVIAR.
alter table brands add column if not exists whatsapp_phone_number_id text;

-- Un mismo phone_number_id no puede pertenecer a dos marcas (si no, los entrantes
-- se atribuirían a la marca equivocada). Único entre los no nulos.
create unique index if not exists brands_whatsapp_phone_number_id_uniq
  on brands(whatsapp_phone_number_id)
  where whatsapp_phone_number_id is not null;

-- 3) El hilo de la ficha filtra por canal.
create index if not exists messages_lead_channel_idx on messages(lead_id, channel);

-- NOTA sobre idempotencia del webhook: `messages_provider_external_id_uniq`
-- (índice único plano de la migración 2026-07-30) ya cubre WhatsApp, porque el
-- par es (provider, external_id) = ('whatsapp', wamid). No hay que tocarlo.

-- Verificación:
select
  (select count(*) from information_schema.columns
     where table_name = 'leads'  and column_name = 'wa_opt_out')                as leads_wa_opt_out,
  (select count(*) from information_schema.columns
     where table_name = 'brands' and column_name = 'whatsapp_phone_number_id')  as brands_wa_phone_id;
