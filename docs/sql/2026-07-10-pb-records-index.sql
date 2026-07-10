-- ============================================================
-- Practice Better — índice local de records (anti-duplicados, bug #2)
-- 100% aditivo: 1 tabla nueva. No modifica ni borra nada existente.
-- Correr en: Supabase Dashboard → SQL Editor → Run
--
-- POR QUÉ: al crear un paciente en PB desde un webhook/intake/admin, antes
-- creábamos a ciegas → si el paciente YA existía en PB, se duplicaba. La forma
-- barata y segura de buscar por email ANTES de crear es contra un espejo local
-- que el poll (poll-practicebetter) alimenta en cada corrida (ya lista TODOS los
-- records de PB). Así el "find by email" es un SELECT local — cero requests
-- extra a PB en el hot path del webhook (que no tolera 10-20s ni el rate limit).
-- El código degrada con gracia si esta tabla aún no existe (crea como hoy).
-- ============================================================

CREATE TABLE IF NOT EXISTS pb_records_index (
  pb_record_id  TEXT PRIMARY KEY,              -- id del record (cliente) en PB
  email_lower   TEXT,                          -- profile.emailAddress en minúsculas
  is_active     BOOLEAN,                       -- record.isActive (para preferir activos)
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Búsqueda por email (el find-by-email del anti-duplicados)
CREATE INDEX IF NOT EXISTS pb_records_index_email_idx ON pb_records_index (email_lower);

ALTER TABLE pb_records_index ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read pb_records_index" ON pb_records_index;
CREATE POLICY "auth read pb_records_index"
  ON pb_records_index FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "service all pb_records_index" ON pb_records_index;
CREATE POLICY "service all pb_records_index"
  ON pb_records_index FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Backstop anti-fuga (bug #2, Fable CRÍTICO #1)
--
-- El código evita que dos leads compartan el mismo pb_record_id, pero el chequeo
-- es "check-then-act" y bajo carrera (webhook + intake del mismo cliente casi a
-- la vez) ambos pueden ganar → un pb_record_id en 2 leads → el poll atribuye
-- los pagos/citas a una clínica al azar. Un índice ÚNICO parcial lo cierra en la
-- base: el segundo INSERT/UPDATE falla y el código ya lo maneja (lost_race).
--
-- PASO 1 — verificar que NO haya duplicados HOY (creados por el bug antes del fix).
-- Si esta consulta devuelve filas, resuélvelas ANTES del PASO 2 (deja el
-- pb_record_id en UN solo lead y pon NULL en los demás), o el índice fallará.
SELECT pb_record_id, count(*) AS leads_con_este_record
FROM leads
WHERE pb_record_id IS NOT NULL
GROUP BY pb_record_id
HAVING count(*) > 1;

-- PASO 2 — crear el índice único parcial (correr después de que el PASO 1 salga vacío).
CREATE UNIQUE INDEX IF NOT EXISTS leads_pb_record_id_uq
  ON leads (pb_record_id) WHERE pb_record_id IS NOT NULL;

-- Verificar
SELECT 'tabla pb_records_index' AS objeto,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='pb_records_index') AS existe
UNION ALL SELECT 'indice unico leads_pb_record_id_uq',
       EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='leads_pb_record_id_uq');
