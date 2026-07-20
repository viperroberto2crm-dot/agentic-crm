-- 2026-07-20 · Agregar 'zelle' al enum payment_method
--
-- CONTEXTO: el metodo de pago de `sales` es un ENUM de Postgres (payment_method),
-- no una columna text con CHECK. Por eso agregar Zelle requiere migracion.
-- `abonos.payment_method` es TEXT libre y NO necesita cambio.
--
-- IMPORTANTE (mismo patron que 2026-07-09-offer-routing.sql):
-- Postgres NO permite usar un valor de enum recien agregado dentro de la MISMA
-- transaccion/lote donde se agrego. Corre este archivo SOLO y confirma antes de
-- desplegar el codigo que ya ofrece Zelle en el dropdown.
--
-- ORDEN OBLIGATORIO:
--   1) correr este SQL en Supabase
--   2) confirmar con la verificacion de abajo
--   3) recien entonces desplegar el codigo

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'zelle';

-- Verificacion: debe listar cash, card, stripe, zelle
-- SELECT unnest(enum_range(NULL::payment_method));
