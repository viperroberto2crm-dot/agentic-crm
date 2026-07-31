-- 2026-07-30 · (Opcional, recomendado) Un número Twilio = una sola marca
-- ============================================================================
-- Endurece la config de "envío por marca": impide registrar el MISMO número
-- Twilio activo en dos marcas a la vez en `tracking_numbers`. El código ya
-- falla-cerrado si hay ambigüedad (no atribuye), esto solo evita la mala config
-- de raíz. Aditivo y seguro. Correr en Supabase → SQL Editor → Run.
--
-- Si YA existiera un número Twilio duplicado activo, este índice fallará al
-- crearse; primero desactiva el duplicado (active=false) y vuelve a correr.
-- ============================================================================

create unique index if not exists tracking_numbers_twilio_phone_uniq
  on tracking_numbers (phone_e164)
  where provider = 'twilio' and active;

-- Verificación:
select indexname from pg_indexes
where tablename = 'tracking_numbers' and indexname = 'tracking_numbers_twilio_phone_uniq';
