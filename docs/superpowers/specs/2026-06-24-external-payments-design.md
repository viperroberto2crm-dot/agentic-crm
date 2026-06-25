# Pagos y Citas Externas (Square → genérico) — Design Spec

**Fecha:** 2026-06-24
**Estado:** En revisión
**Autor:** Roberto (brainstormed con Claude)

---

## Objetivo

Que cuando un paciente **pague** vía Square, el CRM lo sepa y lo registre
vinculado a su lead — sin importar si el pago vino de una página web, de la
terminal en la clínica, o de una factura de Square.

**Marca:** una sola cuenta Square para los 3 negocios (Si Se Pierde). La marca
de cada pago **se hereda del paciente (lead)** al que se vincula —NO de la
cuenta ni de la ubicación de Square—, igual que en Practice Better. Esto hace
que una cuenta única funcione sin mezclar clínicas, y sigue siendo a prueba de
futuro si algún día separan cuentas.

**Citas:** DIFERIDAS. El equipo aún no define dónde se agendarán (Square
Appointments vs Practice Better). El diseño de citas queda documentado abajo
(tabla `external_appointments`, mismo estándar) pero NO se implementa en este
alcance. Se activa cuando se defina el flujo.

**Flujo del paciente (contexto):** el lead entra primero al CRM → el vendedor
lo manda a Practice Better (botón ya existente) → los pagos ocurren en Square y
regresan al CRM por este webhook.

**Principio rector:** construir un **estándar único de pagos externos**,
agnóstico al proveedor. Square es la primera implementación; Stripe u otro
proveedor futuro se agregan como un "adaptador" nuevo **sin tocar** la tabla
de pagos, la UI, los reportes ni el resto del CRM.

A prueba de dos cambios futuros:
1. **Cambiar de proveedor** (Square → Stripe / otro): solo se agrega un
   endpoint adaptador nuevo que traduce al formato común.
2. **Reorganizar cuentas** (una cuenta multi-ubicación → cuentas separadas por
   negocio): solo cambia la configuración (llaves por marca), no el código.

---

## Fuera de alcance (YAGNI)

- **Mandar facturas desde el CRM.** Square ya crea, envía y cobra facturas
  (incluidas recurrentes) por su cuenta. El CRM solo *escucha* cuando se pagan.
- **Procesar/cobrar pagos desde el CRM.** El cobro vive en Square. El CRM es
  de solo lectura respecto al dinero.

---

## Arquitectura

```
Pago en Square (web / clínica / factura)
        │
        ▼  webhook
POST /api/webhooks/payments/square
   1. verifica firma HMAC (Signature Key de Square)
   2. traduce el payload de Square → formato común
   3. detecta el origen (web / in_person / invoice)
   4. resuelve la marca (por cuenta o por location_id)
   5. busca el lead por email/teléfono (aislamiento de marca)
   6. upsert en external_payments (idempotente por external_id)
        │
        ▼
Card de pagos en el perfil del lead
```

Reusa dos patrones ya probados en el CRM:
- **Webhook + firma HMAC** (igual que `webhooks/800com/voice`).
- **Aislamiento de marca + match sin adivinar** (igual que el polling de
  Practice Better: si un email coincide en 2 marcas, NO se adivina).

---

## Modelo de datos

### Tabla genérica `external_payments`

```sql
CREATE TABLE external_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,            -- 'square' | 'stripe' | ...
  brand_id        UUID REFERENCES brands(id) ON DELETE SET NULL,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  external_id     TEXT NOT NULL,            -- id del pago en el proveedor
  amount_cents    INTEGER NOT NULL DEFAULT 0,
  currency        TEXT,
  status          TEXT,                     -- completed | pending | refunded | failed
  origin          TEXT,                     -- 'web' | 'in_person' | 'invoice' | 'unknown'
  customer_email  TEXT,
  customer_phone  TEXT,
  reference       TEXT,                     -- referencia del link/página, si existe
  paid_at         TIMESTAMPTZ,
  raw             JSONB,                    -- payload crudo del proveedor
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)            -- dedup por proveedor
);

CREATE INDEX external_payments_lead_id_idx ON external_payments (lead_id);
CREATE INDEX external_payments_brand_id_idx ON external_payments (brand_id);

ALTER TABLE external_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read external_payments"
  ON external_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "service all external_payments"
  ON external_payments FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**Clave del estándar:** `provider` + `UNIQUE(provider, external_id)`. La UI y
los reportes leen de esta tabla sin saber ni importarles qué proveedor fue.
Stripe el día de mañana = filas con `provider='stripe'`, misma forma.

### Tabla genérica `external_appointments` (citas) — DISEÑO FUTURO, NO en este alcance

```sql
CREATE TABLE external_appointments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,            -- 'square' | ...
  brand_id        UUID REFERENCES brands(id) ON DELETE SET NULL,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  external_id     TEXT NOT NULL,            -- id del booking en el proveedor
  status          TEXT,                     -- booked | completed | cancelled | no_show
  service         TEXT,                     -- nombre del servicio
  staff           TEXT,                     -- profesional asignado
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  customer_email  TEXT,
  customer_phone  TEXT,
  raw             JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE INDEX external_appointments_lead_id_idx ON external_appointments (lead_id);

ALTER TABLE external_appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read external_appointments"
  ON external_appointments FOR SELECT TO authenticated USING (true);
CREATE POLICY "service all external_appointments"
  ON external_appointments FOR ALL TO service_role USING (true) WITH CHECK (true);
```

Citas de Square (Square Appointments / Bookings) entran aquí con
`provider='square'`. Misma filosofía: la UI no se casa con el proveedor.
`pb_appointments` (Practice Better) se mantiene como está; opcionalmente se
migra a esta tabla más adelante (limpieza, no urgente).

---

## Configuración por marca (soporta 1 cuenta o N cuentas)

La integración resuelve, para cada pago entrante: **¿de qué marca es?** y
**¿con qué llave verifico la firma?**

Diseño: un mapa de configuración **por marca**, leído de variables de entorno.

```
# Caso A — UNA cuenta Square, varias ubicaciones (hoy):
SQUARE_SIGNATURE_KEY=<una key>
SQUARE_ACCESS_TOKEN=<un token>
SQUARE_LOCATION_BRAND_MAP={"LOC_AAA":"la-esperanza","LOC_BBB":"sunny-slim","LOC_CCC":"si-se-pierde"}

# Caso B — CUENTAS separadas por negocio (futuro):
# El endpoint identifica la marca por la URL: /api/webhooks/payments/square/<brand-slug>
# y lee las llaves con sufijo por marca:
SQUARE_SIGNATURE_KEY_LA_ESPERANZA=...
SQUARE_ACCESS_TOKEN_LA_ESPERANZA=...
SQUARE_SIGNATURE_KEY_SUNNY_SLIM=...
...
```

El endpoint acepta un slug de marca opcional en la ruta. Si viene, usa las
llaves de esa marca (Caso B). Si no, usa las llaves únicas + el mapa de
location (Caso A). **Migrar de A a B = cambiar env vars y re-registrar el
webhook, sin tocar código.**

> Decisión: empezamos en **Caso A** (una cuenta). El endpoint ya soporta B.

---

## Endpoint: `/api/webhooks/payments/square[/<brand-slug>]`

- `runtime = "nodejs"`, `dynamic = "force-dynamic"`
- En `PUBLIC_PATHS` (sin sesión; se valida por firma).
- **Verificación de firma:** Square firma con HMAC-SHA256 sobre
  `(notification_url + raw_body)` usando la Signature Key; viene en el header
  `x-square-hmacsha256-signature`. Se compara con `crypto.timingSafeEqual`.
  Firma inválida → 401, no se procesa.
- **Eventos:** `payment.created`, `payment.updated` (solo pagos).
  Los de citas (`booking.*`) se suscriben en el futuro si se activan citas.
- **Extracción** (campos reales se confirman con un pago de prueba):
  - `external_id` ← `payment.id`
  - `amount_cents` ← `payment.amount_money.amount` (Square ya da centavos)
  - `currency` ← `payment.amount_money.currency`
  - `status` ← `payment.status` (COMPLETED/APPROVED/...) → normalizado
  - `paid_at` ← `payment.created_at`
  - `origin` ← derivado de `payment.source_type` / presencia de checkout/order
  - `customer_email/phone` ← del payment o, si hace falta, enriquecido con
    `SQUARE_ACCESS_TOKEN` (retrieve customer/order)
  - `reference` ← `reference_id` / nota del order si el link la trae
  - `brand_id` ← por slug en la URL (Caso B) o por `location_id` + mapa (Caso A)
- **Vínculo de lead:** match por email, luego teléfono (E.164), SOLO dentro de
  la(s) marca(s) correspondiente(s). Si coincide en >1 marca → no se adivina,
  el pago queda sin `lead_id` (visible como "sin vincular").
- **Idempotencia:** upsert por `(provider, external_id)`. Reenvíos de Square no
  duplican.
- **Respuesta:** 200 `{ok:true}` rápido (Square reintenta si no recibe 2xx).
- **Defensivo:** un pago que no matchea lead se guarda igual (no se pierde).

---

## UI — perfil del lead

Card **"Pagos"** (genérica, no "Square") en el perfil del lead, mostrando los
`external_payments` de ese lead:

```
┌─ Pagos ───────────────────── $450 total ─┐
│ ✓ $150  Jun 20  🌐 Página web   completed │
│ ✓ $200  Jun 12  🏥 Clínica      completed │
│ ✓ $100  Jun 01  📄 Factura      completed │
└────────────────────────────────────────────┘
```

- Ícono por origen (web / clínica / factura).
- Estilo HORIZON, mismo patrón que la card de Practice Better.
- Solo lectura. Visible para rep/manager/admin (no provider), si hay pagos.

Pagos "sin vincular" (sin lead) se podrán revisar después en una vista de
admin (fase posterior, fuera de este alcance inicial).

---

## Seguridad

- Firma HMAC obligatoria por cada webhook (rechaza falsificaciones).
- Llaves solo en Vercel (Sensitive), nunca en el repo ni en el cliente.
- Service-role solo en el endpoint server-side.
- Aislamiento de marca (sin adivinar entre clínicas).

---

## Pasos del usuario en Square (una vez, con guía)

1. developer.squareup.com → app (producción).
2. Copiar **Access Token** y **Webhook Signature Key**.
3. Crear **webhook subscription** → URL del CRM, eventos `payment.created` y
   `payment.updated` (solo pagos por ahora).
4. Obtener los **location_id** de cada negocio (para el mapa marca↔location).
5. Pegar en Vercel: `SQUARE_SIGNATURE_KEY`, `SQUARE_ACCESS_TOKEN`,
   `SQUARE_LOCATION_BRAND_MAP`.

---

## Fases

| Fase | Contenido | Riesgo |
|---|---|---|
| 1 | Tabla `external_payments` + endpoint webhook (pagos) + firma + match | Bajo (aditivo) |
| 2 | Card de pagos en el perfil del lead | Bajo (aditivo) |
| — (futuro) | Citas: tabla `external_appointments` + bookings, cuando se defina el flujo | Bajo |
| — (futuro) | Vista admin de pagos "sin vincular" | Bajo |
| — (futuro) | Adaptador Stripe / otro: nuevo endpoint, mismas tablas | Bajo |

**Nota:** las citas hoy las crea el vendedor **manualmente** (llamando al
paciente). No se integran en este alcance.

Todo aditivo: tablas y archivos nuevos. No modifica flujos existentes (ventas,
llamadas, citas, Practice Better).

---

## Verificación

- Pago de prueba en Square (sandbox o real pequeño) → llega al webhook →
  aparece en `external_payments` con origen y monto correctos.
- Firma inválida → 401.
- Reenvío del mismo pago → no duplica.
- Pago de un email que existe en 2 marcas → queda sin vincular (no se mezcla).
- La página del lead no se rompe si no hay pagos.
