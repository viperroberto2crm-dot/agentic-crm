-- ============================================================
-- Pagos externos (Square → genérico, a prueba de Stripe)
-- 100% aditivo: tabla nueva. No modifica nada existente.
-- Correr en: Supabase Dashboard → SQL Editor → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS external_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,                 -- 'square' | 'stripe' | ...
  brand_id        UUID REFERENCES brands(id) ON DELETE SET NULL,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  external_id     TEXT NOT NULL,                 -- id del pago en el proveedor
  event_id        TEXT,                          -- id del evento webhook (dedup extra)
  amount_cents    INTEGER NOT NULL DEFAULT 0,
  currency        TEXT,
  status          TEXT,                          -- completed | pending | refunded | failed
  origin          TEXT,                          -- 'web' | 'in_person' | 'invoice' | 'unknown'
  customer_email  TEXT,
  customer_phone  TEXT,
  reference       TEXT,                          -- referencia del link/página, si existe
  paid_at         TIMESTAMPTZ,
  raw             JSONB,                         -- payload crudo del proveedor
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)                 -- idempotencia por proveedor
);

CREATE INDEX IF NOT EXISTS external_payments_lead_id_idx ON external_payments (lead_id);
CREATE INDEX IF NOT EXISTS external_payments_brand_id_idx ON external_payments (brand_id);

ALTER TABLE external_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read external_payments" ON external_payments;
CREATE POLICY "auth read external_payments"
  ON external_payments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "service all external_payments" ON external_payments;
CREATE POLICY "service all external_payments"
  ON external_payments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Verificar
SELECT 'tabla external_payments' AS objeto,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='external_payments') AS existe;
