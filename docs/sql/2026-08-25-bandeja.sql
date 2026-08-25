-- 2026-08-25 · Bandeja unificada de mensajes (/mensajes)
-- ============================================================================
-- CONTEXTO: hoy `messages` solo se lee desde la ficha del paciente, filtrando
-- por lead_id. Los mensajes de quien TODAVÍA NO es lead se guardan bien (con su
-- marca atribuida) pero no hay pantalla que los muestre: se pierden.
--
-- La bandeja los saca a la luz. Esto agrega lo único que le falta a la tabla:
--   1) `read_at` — para saber qué conversación ya se atendió y pintar el badge.
--   2) Índices para listar por marca/fecha y para agrupar por número.
--
-- Correr en: Supabase Dashboard → SQL Editor → Run. 100% aditivo e idempotente.
-- ============================================================================

-- 1) Lectura. NULL = no leído. Solo tiene sentido en los entrantes, pero se deja
--    en toda la tabla para no partir la lógica en dos.
alter table messages add column if not exists read_at timestamptz;

-- 2) La bandeja lista por marca y fecha; el agrupado por conversación usa el
--    número de la contraparte cuando el mensaje no está ligado a un lead.
create index if not exists messages_brand_created_idx on messages(brand_id, created_at desc);
create index if not exists messages_from_number_idx   on messages(from_number);
create index if not exists messages_to_number_idx     on messages(to_number);

-- 3) Los no leídos del badge: entrantes sin read_at. Índice parcial, pequeño.
create index if not exists messages_unread_idx
  on messages(brand_id, created_at desc)
  where direction = 'in' and read_at is null;

-- NOTA de RLS: NO se toca. La policy "brand read messages" (2026-07-30) sigue
-- mandando: un usuario solo ve mensajes de las marcas donde es miembro, y los
-- que quedaron con brand_id null solo los ve el service_role. La bandeja respeta
-- eso; el bucket "Sin marca" es una lectura admin-only explícita en el servidor.

-- Verificación:
select
  (select count(*) from information_schema.columns
     where table_name = 'messages' and column_name = 'read_at') as tiene_read_at,
  (select count(*) from messages where direction = 'in' and lead_id is null) as entrantes_sin_lead;
