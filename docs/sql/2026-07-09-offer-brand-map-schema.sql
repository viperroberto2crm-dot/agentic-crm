-- ============================================================
-- Mapa oferta → clínica (offer_brand_map)
-- Relaciona una oferta/servicio de un proveedor de pagos (Square/Stripe)
-- con la marca (clínica) a la que pertenece, para poder auto-asignar la
-- brand correcta a pagos/citas externas.
-- 100% aditivo: tabla nueva. No modifica nada existente.
-- Correr en: Supabase Dashboard → SQL Editor → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS offer_brand_map (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT NOT NULL CHECK (provider IN ('square', 'stripe')),
  offer_key    TEXT NOT NULL,                 -- id del servicio/variación/precio en el proveedor
  offer_label  TEXT,                          -- nombre legible del servicio
  brand_id     UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  active       BOOLEAN NOT NULL DEFAULT true,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, offer_key)                -- una oferta mapea a una sola clínica
);

CREATE INDEX IF NOT EXISTS offer_brand_map_brand_id_idx ON offer_brand_map (brand_id);
CREATE INDEX IF NOT EXISTS offer_brand_map_provider_active_idx ON offer_brand_map (provider, active);

ALTER TABLE offer_brand_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read offer_brand_map" ON offer_brand_map;
CREATE POLICY "auth read offer_brand_map"
  ON offer_brand_map FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "service all offer_brand_map" ON offer_brand_map;
CREATE POLICY "service all offer_brand_map"
  ON offer_brand_map FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Verificar
SELECT 'tabla offer_brand_map' AS objeto,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='offer_brand_map') AS existe;
