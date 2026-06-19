-- ============================================================
-- Crear la marca "Clínica Médica La Esperanza" (sueros IV)
-- y vincularla a todos los admins/managers para que la vean.
-- Correr en: Supabase Dashboard → SQL Editor → Run
-- Idempotente: se puede correr varias veces sin duplicar.
-- ============================================================

-- 1) Crear el brand si no existe (slug debe coincidir con
--    la env var LANDING_LEAD_BRAND_SLUG = 'la-esperanza')
INSERT INTO brands (slug, name, active)
VALUES ('la-esperanza', 'Clínica Médica La Esperanza', true)
ON CONFLICT (slug) DO NOTHING;

-- 2) Vincular el brand a todos los usuarios admin/manager
--    (para que aparezca en su selector de marca y vean los leads)
INSERT INTO user_brands (user_id, brand_id)
SELECT u.id, b.id
FROM users u
CROSS JOIN brands b
WHERE b.slug = 'la-esperanza'
  AND u.role IN ('admin', 'manager')
  AND NOT EXISTS (
    SELECT 1 FROM user_brands ub
    WHERE ub.user_id = u.id AND ub.brand_id = b.id
  );

-- 3) Verificar resultado
SELECT b.id, b.slug, b.name, b.active,
       (SELECT COUNT(*) FROM user_brands ub WHERE ub.brand_id = b.id) AS usuarios_vinculados
FROM brands b
WHERE b.slug = 'la-esperanza';
