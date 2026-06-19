-- ============================================================
-- Practice Better — esquema (FASE 1)
-- 100% aditivo: columnas nuevas (nullable) + 2 tablas nuevas.
-- No modifica ni borra nada existente.
-- Correr en: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- 1) Vincular un lead con su cliente en Practice Better
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS pb_record_id TEXT,
  ADD COLUMN IF NOT EXISTS pb_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS leads_pb_record_id_idx ON leads (pb_record_id);

-- 2) Citas / paquetes traídos de Practice Better (polling)
CREATE TABLE IF NOT EXISTS pb_appointments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      UUID REFERENCES brands(id) ON DELETE SET NULL,
  lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE,
  pb_id         TEXT NOT NULL UNIQUE,         -- id en Practice Better (dedup)
  pb_record_id  TEXT,                          -- cliente PB dueño de la cita
  name          TEXT,
  status        TEXT,
  scheduled_at  TIMESTAMPTZ,
  raw           JSONB,                         -- payload crudo por si falta un campo
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pb_appointments_lead_id_idx ON pb_appointments (lead_id);

ALTER TABLE pb_appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read pb_appointments" ON pb_appointments;
CREATE POLICY "auth read pb_appointments"
  ON pb_appointments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "service all pb_appointments" ON pb_appointments;
CREATE POLICY "service all pb_appointments"
  ON pb_appointments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3) Pagos / invoices traídos de Practice Better (polling)
CREATE TABLE IF NOT EXISTS pb_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      UUID REFERENCES brands(id) ON DELETE SET NULL,
  lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE,
  pb_id         TEXT NOT NULL UNIQUE,         -- id de invoice en PB (dedup)
  pb_record_id  TEXT,
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  currency      TEXT,
  status        TEXT,
  paid_at       TIMESTAMPTZ,
  number        TEXT,
  raw           JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pb_payments_lead_id_idx ON pb_payments (lead_id);

ALTER TABLE pb_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read pb_payments" ON pb_payments;
CREATE POLICY "auth read pb_payments"
  ON pb_payments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "service all pb_payments" ON pb_payments;
CREATE POLICY "service all pb_payments"
  ON pb_payments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4) Verificar
SELECT 'leads.pb_record_id' AS objeto,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='leads' AND column_name='pb_record_id') AS existe
UNION ALL SELECT 'tabla pb_appointments',
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='pb_appointments')
UNION ALL SELECT 'tabla pb_payments',
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='pb_payments');
