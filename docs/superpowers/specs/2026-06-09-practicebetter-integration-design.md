# Practice Better Integration — Design Spec
**Date:** 2026-06-09  
**Status:** Approved  
**Author:** Roberto (brainstormed with Claude)

---

## Objetivo

Conectar el CRM con Practice Better (practicebetter.io) para que los vendedores vean en el perfil del lead:
- Si el cliente fue enviado a Practice Better
- Cuándo fue atendido (citas)
- Cuánto ha pagado (pagos)

**Sin datos médicos.** No se captura ni almacena ningún dato clínico (diagnósticos, medicamentos, resultados, autorizaciones médicas). Solo coordinación: citas y pagos.

> **Decisión 2026-06-09:** Se descartó capturar la autorización de GLP porque es PHI bajo HIPAA. El CRM no es un Business Associate registrado y no tiene los controles técnicos requeridos. Si en el futuro la empresa invierte en HIPAA compliance, se puede retomar.

---

## Principio de implementación

**Todos los cambios son aditivos.** No se modifica ningún archivo existente en su lógica principal. Solo se añaden:
- Columnas nuevas a la tabla `leads` (nullable, no afectan filas existentes)
- Dos tablas nuevas (`pb_appointments`, `pb_payments`)
- Un endpoint nuevo (`/api/webhooks/practicebetter`)
- Un archivo nuevo de integración (`src/lib/integrations/practice-better.ts`)
- Una card nueva en el UI del lead (no reemplaza nada existente)

---

## Flujo de datos

### Salida: CRM → Practice Better
**Trigger:** cuando `sales.payment_status` cambia a `'paid'` en el CRM  
**Acción:** POST a Practice Better API `/v1/clients` con nombre, email, teléfono del lead  
**Resultado:** guardamos `pb_client_id` y `pb_synced_at` en el lead

### Entrada: Practice Better → CRM (webhooks)
**Endpoint:** `POST /api/webhooks/practicebetter`  
**Seguridad:** verificación HMAC-SHA256 con header `x-practice-better-signature` (mismo patrón que 800.com)  
**Eventos manejados:**

| Evento PB | Acción en CRM |
|---|---|
| `appointment.created` | INSERT en `pb_appointments` |
| `appointment.updated` | UPSERT en `pb_appointments` por `pb_appointment_id` |
| `appointment.cancelled` | UPDATE status='cancelled' en `pb_appointments` |
| `payment.created` | INSERT en `pb_payments` |

**Deduplicación:** UPSERT por `pb_appointment_id` y `pb_payment_id` — idempotente ante reenvíos.

**Link lead ↔ PB client:** usando `pb_client_id`. Si el webhook llega de un cliente que no existe en el CRM (paciente de regreso capturado directamente en PB), se busca por email o teléfono para vincular.

---

## Base de datos

### Nuevas columnas en `leads`
```sql
ALTER TABLE leads
  ADD COLUMN pb_client_id  TEXT UNIQUE,
  ADD COLUMN pb_synced_at  TIMESTAMPTZ;
```

### Nueva tabla `pb_appointments`
```sql
CREATE TABLE pb_appointments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  pb_appointment_id TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'scheduled',
    -- valores: scheduled | completed | cancelled
  scheduled_at      TIMESTAMPTZ NOT NULL,
  completed_at      TIMESTAMPTZ,
  appointment_type  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pb_appointments_lead_id_idx ON pb_appointments(lead_id);

ALTER TABLE pb_appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read pb_appointments"
  ON pb_appointments FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "service role all pb_appointments"
  ON pb_appointments FOR ALL TO service_role
  USING (true);
```

### Nueva tabla `pb_payments`
```sql
CREATE TABLE pb_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id        UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  pb_payment_id  TEXT NOT NULL UNIQUE,
  amount_cents   INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'paid',
    -- valores: paid | refunded | pending
  paid_at        TIMESTAMPTZ,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pb_payments_lead_id_idx ON pb_payments(lead_id);

ALTER TABLE pb_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read pb_payments"
  ON pb_payments FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "service role all pb_payments"
  ON pb_payments FOR ALL TO service_role
  USING (true);
```

---

## Variables de entorno nuevas
```
PB_API_KEY=           # API key de Practice Better (generada en Settings → API Access)
PB_WEBHOOK_SECRET=    # Secret para verificar HMAC-SHA256
PB_API_BASE_URL=https://api.practicebetter.io/v1
```

---

## Archivos a crear

| Archivo | Descripción |
|---|---|
| `src/lib/integrations/practice-better.ts` | Cliente API: `createClient()`, `getClient()` |
| `src/app/api/webhooks/practicebetter/route.ts` | Endpoint webhook con verificación HMAC |
| `src/components/leads/PracticeBetterCard.tsx` | Card UI en perfil del lead |
| `src/app/(app)/leads/[id]/actions.ts` | `syncLeadToPracticeBetter()` (llamada al cerrar venta) |

## Archivos a modificar (solo adiciones)

| Archivo | Cambio |
|---|---|
| `src/app/(app)/leads/[id]/page.tsx` | Añadir `<PracticeBetterCard>` al perfil |
| `src/app/(app)/sales/[id]/actions.ts` o equivalente | Llamar `syncLeadToPracticeBetter()` cuando `payment_status` → `paid` |
| `.env.example` | Añadir las 3 vars nuevas |
| `vercel.json` | Sin cambios — no hay cron nuevo |

---

## UI — Card "Practice Better" en perfil del lead

### Estado: No sincronizado
```
┌─ Practice Better ─────────────────────────┐
│  Sin sincronizar                           │
│  Se enviará automáticamente al cerrar      │
│  la venta                                  │
└────────────────────────────────────────────┘
```

### Estado: Sincronizado con datos
```
┌─ Practice Better ──────────────── ✓ Activo ┐
│                                            │
│  Citas       3 total · próxima Jun 15      │
│  Pagos       $1,200  · último Jun 1        │
│                                            │
│  [Ver citas]        [Ver pagos]            │
└────────────────────────────────────────────┘
```

### Estado: Error de sync
```
┌─ Practice Better ──────────────── ⚠ Error ─┐
│  No se pudo crear el cliente en PB          │
│  [Reintentar]                               │
└─────────────────────────────────────────────┘
```

---

## Manejo de pacientes de regreso

Si Practice Better envía un webhook de un cliente que NO tiene `pb_client_id` en ningún lead del CRM:
1. Buscar lead por email exacto
2. Si no → buscar por teléfono (E.164 normalizado)
3. Si no → log de warning, no crear lead nuevo automáticamente (evitar duplicados)

---

## Estimado de trabajo

| Tarea | Tiempo |
|---|---|
| SQL + env vars | 1h |
| `practice-better.ts` (cliente API) | 2h |
| Webhook endpoint + HMAC | 2h |
| Trigger al cerrar venta | 1h |
| Card UI + queries | 3h |
| Pruebas con webhook tester de PB | 1h |
| **Total** | **~10h (2 días)** |
