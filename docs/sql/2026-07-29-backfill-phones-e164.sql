-- 2026-07-29 · Backfill: normalizar leads.phone y leads.phone_alt a E.164
-- ============================================================================
-- CONTEXTO: los telefonos de leads se guardaban en 3 formatos ("8183176399",
-- "19094719739", "+19094719739"). El match por telefono (crons, webhooks, auto-
-- link de llamadas) usa igualdad exacta, asi que un formato distinto = NO
-- matchea => se crean leads DUPLICADOS y se mal-vinculan llamadas/pagos.
--
-- El codigo YA fue arreglado para escribir E.164 en todos los puntos de entrada
-- (Nuevo lead, edicion, import CSV, import-plans, crear-desde-pago). Este script
-- arregla los datos VIEJOS que ya estan en la base.
--
-- Empareja la logica de normalizeToE164() del codigo:
--   empieza con '+'  -> '+' + solo digitos del resto
--   10 digitos       -> +1 + digitos   (US)
--   >= 11 digitos    -> '+' + digitos  (asume country code)
--   < 10 digitos y sin '+' -> se DEJA IGUAL (probable basura, no lo tocamos)
--
-- Idempotente: solo cambia filas cuyo valor difiere del normalizado. Correrlo
-- de nuevo no hace nada.
--
-- ⚠️ ADVERTENCIA CRÍTICA (Fable): existe un índice ÚNICO en la base
--   CREATE UNIQUE INDEX leads_brand_phone_uniq ON leads (brand_id, phone)
--   WHERE phone IS NOT NULL;
-- Si dos leads de la MISMA marca son la misma persona en formatos distintos
-- ("8183176399" y "+18183176399"), normalizar los COLAPSA al mismo (brand_id,
-- phone) y el UPDATE aborta ENTERO con error 23505 (0 filas cambian; falla
-- seguro, no corrompe, pero no corre). POR ESO el PASO 0 es obligatorio: hay
-- que encontrar y FUSIONAR esos duplicados antes de correr el PASO 2.
-- ============================================================================

-- ── PASO 0: DETECTAR COLISIONES (¡correr primero!). Si devuelve filas, hay
--    leads duplicados que se colapsarían — hay que fusionarlos ANTES del PASO 2.
--    Cada grupo = una persona guardada 2+ veces con teléfonos en formato distinto. ──
with norm as (
  select
    id, brand_id, first_name, last_name, phone,
    case
      when phone is null or btrim(phone) = '' then phone
      when left(btrim(phone), 1) = '+'
        then '+' || regexp_replace(substring(btrim(phone) from 2), '\D', '', 'g')
      when length(regexp_replace(btrim(phone), '\D', '', 'g')) = 10
        then '+1' || regexp_replace(btrim(phone), '\D', '', 'g')
      when length(regexp_replace(btrim(phone), '\D', '', 'g')) >= 11
        then '+'  || regexp_replace(btrim(phone), '\D', '', 'g')
      else phone
    end as phone_e164
  from leads
  where phone is not null and btrim(phone) <> ''
)
select brand_id, phone_e164,
       count(*) as leads_duplicados,
       array_agg(id)                                    as ids,
       array_agg(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) as nombres,
       array_agg(phone)                                 as telefonos_actuales
from norm
group by brand_id, phone_e164
having count(*) > 1
order by count(*) desc;
-- Si esto devuelve 0 filas → no hay colisiones, puedes saltar al PASO 2 con seguridad.
-- Si devuelve filas → NO corras el PASO 2 todavía; hay que fusionar cada grupo
--   (re-apuntar FKs del lead viejo al bueno y borrar el duplicado). Hay un
--   procedimiento documentado en docs/REBUILD-PLAYBOOK.md. Avísame y lo armamos.


-- ── PASO 1: PREVIEW (no cambia NADA). Corre esto primero y revisa. ──
with norm as (
  select
    id,
    phone,
    case
      when phone is null or btrim(phone) = '' then phone
      when left(btrim(phone), 1) = '+'
        then '+' || regexp_replace(substring(btrim(phone) from 2), '\D', '', 'g')
      when length(regexp_replace(btrim(phone), '\D', '', 'g')) = 10
        then '+1' || regexp_replace(btrim(phone), '\D', '', 'g')
      when length(regexp_replace(btrim(phone), '\D', '', 'g')) >= 11
        then '+'  || regexp_replace(btrim(phone), '\D', '', 'g')
      else phone
    end as phone_e164
  from leads
)
select
  count(*) filter (where phone is distinct from phone_e164) as phones_a_cambiar,
  count(*)                                                   as total_leads
from norm;

-- (Opcional) ver ejemplos concretos de lo que cambiaria:
-- with norm as ( ... mismo CTE de arriba ... )
-- select id, phone, phone_e164 from norm where phone is distinct from phone_e164 limit 30;


-- ── PASO 2: APLICAR a leads.phone (despues de revisar el preview). ──
with norm as (
  select
    id,
    case
      when left(btrim(phone), 1) = '+'
        then '+' || regexp_replace(substring(btrim(phone) from 2), '\D', '', 'g')
      when length(regexp_replace(btrim(phone), '\D', '', 'g')) = 10
        then '+1' || regexp_replace(btrim(phone), '\D', '', 'g')
      when length(regexp_replace(btrim(phone), '\D', '', 'g')) >= 11
        then '+'  || regexp_replace(btrim(phone), '\D', '', 'g')
      else phone
    end as phone_e164
  from leads
  where phone is not null and btrim(phone) <> ''
)
update leads l
set phone = n.phone_e164
from norm n
where l.id = n.id
  and l.phone is distinct from n.phone_e164;


-- ── PASO 3: APLICAR a leads.phone_alt (mismo tratamiento). ──
with norm as (
  select
    id,
    case
      when left(btrim(phone_alt), 1) = '+'
        then '+' || regexp_replace(substring(btrim(phone_alt) from 2), '\D', '', 'g')
      when length(regexp_replace(btrim(phone_alt), '\D', '', 'g')) = 10
        then '+1' || regexp_replace(btrim(phone_alt), '\D', '', 'g')
      when length(regexp_replace(btrim(phone_alt), '\D', '', 'g')) >= 11
        then '+'  || regexp_replace(btrim(phone_alt), '\D', '', 'g')
      else phone_alt
    end as alt_e164
  from leads
  where phone_alt is not null and btrim(phone_alt) <> ''
)
update leads l
set phone_alt = n.alt_e164
from norm n
where l.id = n.id
  and l.phone_alt is distinct from n.alt_e164;

-- Verificacion: cuantos quedan sin '+' (deberian ser solo basura < 10 digitos)
-- select count(*) from leads where phone is not null and left(phone,1) <> '+';
