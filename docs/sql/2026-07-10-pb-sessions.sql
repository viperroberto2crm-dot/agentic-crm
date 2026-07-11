-- ============================================================
-- Fase 3: crear la CITA dentro de Practice Better (POST /consultant/sessions)
-- 100% aditivo: tabla nueva + columnas nuevas. No modifica nada existente.
-- Correr en: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ── 1) Mapa servicio Square → servicio Practice Better ───────────────────────
-- PB necesita SU propio serviceId (el service_variation_id de Square no sirve).
-- Roberto lo llena una vez desde Settings (pantalla que jala GET /consultant/services).
CREATE TABLE IF NOT EXISTS square_pb_service_map (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  square_variation_id TEXT NOT NULL UNIQUE,   -- service_variation_id de Square
  square_label        TEXT,                   -- nombre legible del servicio Square
  pb_service_id       TEXT NOT NULL,          -- serviceId de PB (GET /consultant/services)
  pb_service_name     TEXT,                   -- nombre legible del servicio PB
  pb_service_type     TEXT NOT NULL DEFAULT 'virtual', -- face | phone | virtual
  duration_min        INTEGER,                -- override; null → usar duración del booking
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE square_pb_service_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read square_pb_service_map" ON square_pb_service_map;
CREATE POLICY "auth read square_pb_service_map"
  ON square_pb_service_map FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "service all square_pb_service_map" ON square_pb_service_map;
CREATE POLICY "service all square_pb_service_map"
  ON square_pb_service_map FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 2) Idempotencia de sesiones en external_appointments ─────────────────────
-- pb_session_id = llave maestra: fila con valor ⇒ nunca más POST, solo PUT.
ALTER TABLE external_appointments
  ADD COLUMN IF NOT EXISTS pb_session_id       TEXT,
  ADD COLUMN IF NOT EXISTS pb_session_status   TEXT,   -- pushed|pushing|failed|unmapped|skipped|cancelled
  ADD COLUMN IF NOT EXISTS pb_session_pushed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pb_claimed_at       TIMESTAMPTZ, -- cuándo se tomó el claim (para rescatar 'pushing' colgado)
  ADD COLUMN IF NOT EXISTS pb_error            TEXT,
  ADD COLUMN IF NOT EXISTS pb_fee_cents        INTEGER,
  ADD COLUMN IF NOT EXISTS pb_fee_payment_id   UUID;   -- qué external_payments alimentó el fee

-- Un pago solo puede dar fee a UNA sesión (auditoría).
ALTER TABLE external_payments
  ADD COLUMN IF NOT EXISTS pb_fee_applied_to   UUID;   -- FK lógica a external_appointments.id

-- Índice para buscar rápido citas por estado (cola de "sin mapear" / reintentos).
CREATE INDEX IF NOT EXISTS external_appointments_pb_session_status_idx
  ON external_appointments (pb_session_status);

-- Verificar
SELECT 'square_pb_service_map' AS objeto,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='square_pb_service_map') AS existe
UNION ALL
SELECT 'external_appointments.pb_session_id',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='external_appointments' AND column_name='pb_session_id');
