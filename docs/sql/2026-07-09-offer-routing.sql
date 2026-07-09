-- ============================================================
-- Ruteo automático de ofertas → creación de leads (offer routing)
-- Complementa 2026-07-09-offer-brand-map-schema.sql.
--
-- Habilita que un pago/cita de Square o Stripe SIN lead pueda:
--   1) mapear su oferta (por ID exacto) a una clínica vía offer_brand_map, y
--   2) crear el lead correcto (source='square'/'stripe'), o
--   3) caer en la marca centinela 'unassigned' (nunca se pierde, queda
--      visible en /admin/external-unlinked para reasignar a mano).
--
-- 100% aditivo. NO modifica datos existentes.
--
-- ⚠️ IMPORTANTE: correr en DOS bloques SEPARADOS.
--    Postgres NO permite usar un valor de enum recién agregado (ALTER TYPE
--    ... ADD VALUE) dentro de la MISMA transacción/lote donde se agregó.
--    Corre primero el BLOQUE 1, dale Run; LUEGO corre el BLOQUE 2.
-- ============================================================


-- ┌──────────────────────────────────────────────────────────┐
-- │ BLOQUE 1  — correr SOLO esto primero, y darle Run.        │
-- └──────────────────────────────────────────────────────────┘
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'square';
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'stripe';


-- ┌──────────────────────────────────────────────────────────┐
-- │ BLOQUE 2  — correr DESPUÉS de que el BLOQUE 1 terminó.    │
-- └──────────────────────────────────────────────────────────┘

-- Marca centinela para ofertas NO mapeadas. active=false → no aparece en
-- selectores normales, pero el lead nunca se pierde (queda en external-unlinked).
INSERT INTO brands (slug, name, active)
VALUES ('unassigned', 'Sin Asignar (interno — reasignar)', false)
ON CONFLICT (slug) DO NOTHING;

-- Idempotencia a nivel BASE DE DATOS: un lead externo (provider+external_id)
-- no puede duplicarse aunque dos webhooks lleguen en carrera. Índice parcial:
-- solo aplica cuando external_id NO es null (los leads internos no lo tienen).
CREATE UNIQUE INDEX IF NOT EXISTS leads_external_provider_id_uq
  ON leads (external_provider, external_id)
  WHERE external_id IS NOT NULL;

-- Verificar
SELECT 'brand unassigned' AS objeto,
       EXISTS (SELECT 1 FROM brands WHERE slug='unassigned') AS existe
UNION ALL
SELECT 'indice leads_external_provider_id_uq' AS objeto,
       EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='leads_external_provider_id_uq') AS existe;
