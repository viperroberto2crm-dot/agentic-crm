-- ============================================================
-- Nombres legibles de citas externas (Square)
-- 100% aditivo: 2 columnas nuevas. No modifica nada existente.
-- Guarda el nombre resuelto de servicio/staff (los IDs crudos siguen en
-- service/staff como fuente de verdad). El webhook los llena al ingerir el
-- booking cuando SQUARE_RESOLVE_NAMES=true; si está off, quedan NULL y la UI
-- cae al ID crudo (sin regresión).
-- Correr en: Supabase Dashboard → SQL Editor → Run
-- ============================================================

ALTER TABLE external_appointments
  ADD COLUMN IF NOT EXISTS service_name TEXT,
  ADD COLUMN IF NOT EXISTS staff_name   TEXT;

-- Verificar
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'external_appointments'
  AND column_name IN ('service_name', 'staff_name')
ORDER BY column_name;
