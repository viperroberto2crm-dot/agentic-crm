-- ============================================================
-- DIAGNÓSTICO: ¿por qué la cita de Leslie no muestra pago?
-- Solo LECTURA (SELECTs). No modifica nada. Correr en Supabase → SQL Editor.
-- Objetivo: determinar si el pago (a) existe pero no se vinculó, (b) se perdió
-- en el apagón del webhook (7-9 jul), o (c) nunca hubo pago.
-- ============================================================

-- 1) El lead de Leslie (email leslie@sky-decks.com). Confirmar id + brand.
SELECT id, brand_id, first_name, last_name, email, phone, pb_record_id, source, created_at
FROM leads
WHERE email ILIKE 'leslie@sky-decks.com' OR first_name ILIKE '%Leslie%';

-- 2) La CITA de Square de Leslie: sacar el customer_id de Square del raw.
--    (ese customer_id es la llave para buscar su pago)
SELECT external_id AS booking_id,
       lead_id,
       status,
       service,
       service_name,
       starts_at,
       customer_name,
       customer_email,
       raw #>> '{booking,customer_id}' AS square_customer_id
FROM external_appointments
WHERE provider = 'square'
  AND (customer_email ILIKE 'leslie@sky-decks.com'
       OR customer_name ILIKE '%Leslie%'
       OR lead_id IN (SELECT id FROM leads WHERE email ILIKE 'leslie@sky-decks.com'));

-- 3) ¿Existe ALGÚN pago de Square vinculado a su lead o con su email/nombre?
SELECT external_id AS payment_id,
       lead_id,
       amount_cents,
       currency,
       status,
       origin,
       items,
       customer_name,
       customer_email,
       paid_at,
       raw #>> '{payment,customer_id}' AS square_customer_id
FROM external_payments
WHERE provider = 'square'
  AND (customer_email ILIKE 'leslie@sky-decks.com'
       OR customer_name ILIKE '%Leslie%'
       OR lead_id IN (SELECT id FROM leads WHERE email ILIKE 'leslie@sky-decks.com'));

-- 4) ¿Hay un pago de Square con el MISMO customer_id que la cita, aunque quedara
--    SIN vincular a un lead? (pega aquí el square_customer_id del query #2)
--    Descomenta y reemplaza <CUSTOMER_ID>:
-- SELECT external_id AS payment_id, lead_id, amount_cents, status, paid_at,
--        customer_name, customer_email
-- FROM external_payments
-- WHERE provider = 'square'
--   AND raw #>> '{payment,customer_id}' = '<CUSTOMER_ID>';

-- 5) Panorama: pagos de Square SIN vincular (lead_id NULL) de los últimos 10 días.
--    Si el pago de Leslie llegó pero no matcheó, aparecería aquí.
SELECT external_id AS payment_id, amount_cents, currency, status, origin,
       customer_name, customer_email, paid_at
FROM external_payments
WHERE provider = 'square'
  AND lead_id IS NULL
  AND paid_at >= now() - interval '10 days'
ORDER BY paid_at DESC;
