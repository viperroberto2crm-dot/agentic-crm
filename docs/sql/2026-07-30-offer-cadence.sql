-- 2026-07-30 · Cadencia (plan) por oferta → para calcular cobertura de prepago
-- ============================================================================
-- CONTEXTO: la etiqueta "Cubierto hasta X / Sin cobertura" necesita saber cuántos
-- días cubre cada pago. Los pagos crudos de Stripe/Square (external_payments) NO
-- guardan el plan, pero SÍ el precio (raw.payment_link / raw...price / variación).
-- offer_brand_map ya mapea ese precio → marca; aquí le agregamos la CADENCIA para
-- mapear precio → plan (Semanal/Mensual/Trimestral/Anual).
--
-- Valores válidos: weekly | monthly | quarterly | annual | one_time (o NULL = sin
-- definir). Mismos strings que usa `products.cadence`. Aditivo. Correr en Supabase.
-- ============================================================================

alter table offer_brand_map add column if not exists cadence text;

-- Verificación:
select column_name from information_schema.columns
where table_name = 'offer_brand_map' and column_name = 'cadence';
