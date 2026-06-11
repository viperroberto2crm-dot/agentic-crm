-- ============================================================
-- DIAGNÓSTICO: llamadas de 800.com mezcladas bajo Si Se Pierde
-- 100% SOLO LECTURA — no modifica nada.
-- Correr en: Supabase Dashboard → SQL Editor → pegar y Run
-- ============================================================

-- 1) Números de tracking REGISTRADOS (los oficiales del CRM)
SELECT tn.phone_e164, tn.label, b.name AS brand,
       tn.provider_metadata->>'number_id' AS numero_id_800
FROM tracking_numbers tn
LEFT JOIN brands b ON b.id = tn.brand_id
ORDER BY b.name, tn.label;

-- 2) TODAS las llamadas de 800.com agrupadas por número marcado (dialed):
--    cuántas llamadas, cuántos leads vinculados, y si el número está registrado
SELECT
  c.dialed_e164                            AS numero_marcado,
  COUNT(*)                                 AS llamadas,
  COUNT(DISTINCT c.lead_id)                AS leads_vinculados,
  MIN(c.called_at)::date                   AS primera_llamada,
  MAX(c.called_at)::date                   AS ultima_llamada,
  CASE WHEN EXISTS (
    SELECT 1 FROM tracking_numbers tn WHERE tn.phone_e164 = c.dialed_e164
  ) THEN 'SÍ — registrado' ELSE '*** AJENO ***' END AS registrado
FROM calls c
WHERE c.source = '800com'
GROUP BY c.dialed_e164
ORDER BY llamadas DESC;

-- 3) Leads vinculados a llamadas de números AJENOS (los "revueltos"),
--    con cuántas ventas y citas tiene cada uno (clave para decidir qué hacer)
WITH ajenos AS (
  SELECT DISTINCT c.lead_id
  FROM calls c
  WHERE c.source = '800com'
    AND c.lead_id IS NOT NULL
    AND c.dialed_e164 IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM tracking_numbers tn WHERE tn.phone_e164 = c.dialed_e164
    )
)
SELECT
  l.id, l.first_name, l.last_name, l.phone, l.source, l.status,
  l.created_at::date AS creado,
  (SELECT COUNT(*) FROM sales s        WHERE s.lead_id = l.id) AS ventas,
  (SELECT COUNT(*) FROM appointments a WHERE a.lead_id = l.id) AS citas,
  (SELECT COUNT(*) FROM calls c2       WHERE c2.lead_id = l.id
     AND EXISTS (SELECT 1 FROM tracking_numbers tn WHERE tn.phone_e164 = c2.dialed_e164)
  ) AS llamadas_a_numeros_propios
FROM leads l
JOIN ajenos x ON x.lead_id = l.id
ORDER BY ventas DESC, citas DESC, l.created_at;

-- ============================================================
-- Interpretación:
--  · Query 2: cada fila "*** AJENO ***" es un número de la cuenta
--    A&O que NO pertenece a Si Se Pierde y se coló en los backfills.
--  · Query 3: los leads enredados. Si un lead tiene ventas>0 o
--    citas>0 o llamadas_a_numeros_propios>0, NO es puro ruido y
--    no se debe borrar a ciegas.
-- Pega los resultados de las 3 queries en el chat y te genero el
-- SQL de corrección exacto (borrar / reasignar según cada caso).
-- ============================================================
