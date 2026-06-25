-- ============================================================
-- Citas externas (Square Appointments → genérico)
-- 100% aditivo: tabla nueva. No modifica nada existente.
-- Correr en: Supabase Dashboard → SQL Editor → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS external_appointments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,                 -- 'square' | ...
  brand_id        UUID REFERENCES brands(id) ON DELETE SET NULL,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  external_id     TEXT NOT NULL,                 -- id del booking en el proveedor
  event_id        TEXT,
  status          TEXT,                          -- booked | pending | cancelled | no_show
  service         TEXT,                          -- nombre/ID del servicio
  staff           TEXT,                          -- nombre/ID del profesional
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  customer_name   TEXT,
  customer_email  TEXT,
  customer_phone  TEXT,
  customer_address TEXT,
  note            TEXT,
  raw             JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS external_appointments_lead_id_idx ON external_appointments (lead_id);
CREATE INDEX IF NOT EXISTS external_appointments_brand_id_idx ON external_appointments (brand_id);

ALTER TABLE external_appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read external_appointments" ON external_appointments;
CREATE POLICY "auth read external_appointments"
  ON external_appointments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "service all external_appointments" ON external_appointments;
CREATE POLICY "service all external_appointments"
  ON external_appointments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Verificar
SELECT 'tabla external_appointments' AS objeto,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='external_appointments') AS existe;
