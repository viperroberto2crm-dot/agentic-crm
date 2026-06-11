# Estado del CRM — Cómo está conectado y cómo funciona

> Documento de inspección. Refleja el código real al 2026-06-08, no de memoria.
> Generado tras mapear los 4 subsistemas (call tracking, datos/seguridad, app, bot/Meta).

---

## 0. Mapa general en una frente

```
                          ┌──────────────────────────────────────┐
   FUENTES DE LEADS       │            CRM (Next.js 15)           │      USUARIOS
   ───────────────        │         Vercel + Supabase             │      ────────
                          │                                       │
  800.com (llamadas) ───► Webhook /api/webhooks/800com/voice ───► │
                          │                                  │    │   Admin   ─┐
  800.com (polling)  ───► Cron /api/cron/auto-link-calls ────┤    │   Manager ─┤
                          │                                  │    │   Rep     ─┼─► RLS por rol+brand
  Meta Lead Ads      ───► Cron /api/agent/poll-meta-leads ───┤    │   Provider─┘
                          │                                  ▼    │
                          │                          ┌─────────────┐
  Bot interno (Claude)◄──►│  /api/agent/ask          │  Postgres   │
                          │  tools read/write        │  (Supabase) │
  Hermes (auto-salud)◄───►│  /api/hermes/tick        └─────────────┘
                          └──────────────────────────────────────┘
```

El CRM es un **pipeline de ventas y citas multi-marca**:
**Lead → Llamada → Cita → Venta → Pagos (planes a plazos)**, con control de acceso por rol y por marca.

- **Framework:** Next.js 15 App Router (Server Actions + Server Components)
- **Base de datos / Auth / Realtime:** Supabase (Postgres)
- **Hosting:** Vercel (Rolling Releases — el deploy NO auto-promueve el alias prod, hay que `vercel alias set`)
- **Integraciones vivas:** 800.com (call tracking) y Meta Lead Ads (formularios Facebook)
- **IA:** bot interno con Claude (`claude-sonnet-4-6`) + Hermes (bot de auto-salud)

---

## 1. Captura de llamadas (800.com) — el subsistema más crítico

Hay **3 caminos** que meten llamadas/contactos al CRM, todos deduplican y son idempotentes.

### 1.1 Webhook en tiempo real — `src/app/api/webhooks/800com/voice/route.ts`
**El receptor protegido.** Es lo que hace que una llamada aparezca al instante.

- **Eventos que procesa:**
  - `call_started` → INSERT de la llamada con `outcome=null` (estado "sonando")
  - `call_completed` → UPDATE con `outcome` + `duration_seconds` + `ended_at`
  - `call_decorated` → UPDATE con `recording_url` + `transcription`
  - `call_updated` → UPDATE de cambios posteriores
  - `sms_received` → ignorado
- **Autenticación:** secreto en query param `?secret=` (`EIGHTHUNDRED_WEBHOOK_SECRET`).
- **Ejecución asíncrona:** responde `200 { ok, accepted }` de inmediato y hace el trabajo pesado en `after()` con try/catch. Esto evita el timeout de 800.com (su deadline es corto; sin `after()` los cold starts daban httpResponseCode 0).
- **Dedup:** por `external_id` + `source='800com'`. Si llega `call_started` y `call_completed` casi a la vez, el segundo INSERT falla por índice único y se trata como OK ("race: duplicate"). No hay duplicados.
- **Resolución de marca/rep/tracking (`resolveTracking`):**
  1. Carga todos los `tracking_numbers` activos de `provider='800com'`.
  2. Match por `provider_metadata.number_id` (el id numérico del 800.com).
  3. Fallback: match del número marcado contra `phone_e164`.
  4. Devuelve `{ brand_id, rep_id, tracking_number_id }`.
  5. **Rep:** primer rep/manager/admin activo de ESE brand; si no hay, fallback al admin activo más antiguo. (Por eso un cambio aquí es delicado — se atribuye a la marca correcta, no al admin global).
- **Dirección (lógica corregida):**
  `isInbound = call.isInbound === true || call.direction === "inbound" || (ambos undefined)`.
  Si `isInbound===false` → se marca **outbound** (evita el "toast fantasma" de salientes mal marcadas como entrantes).
- **Columnas que escribe en el INSERT:** `brand_id, lead_id, rep_id, direction, outcome, duration_seconds, caller_e164, dialed_e164, tracking_number_id, source='800com', external_id, recording_url, called_at, ringing_at, transcription`.

> ⚠️ **Regla operativa:** no tocar este archivo sin autorización explícita. Históricamente romper aquí cortó la captura por horas.

### 1.2 Cron de enlace — `src/app/api/cron/auto-link-calls/route.ts`
Engancha llamadas huérfanas (`lead_id IS NULL`) a leads, usando datos enriquecidos.

- **Auth:** Bearer `CRON_SECRET` o `HERMES_SECRET`.
- **Ventana:** `?days=N` (default 1 día; backfill puede pedir `?days=30`).
- **Topes de costo/tiempo:** `ORPHANS_LIMIT=500`, `CONV_MAX_PAGES=5`, `MAX_ENRICH=50` (para no exceder `maxDuration=60`).
- **Flujo por huérfana:**
  1. Resuelve teléfono (`caller_e164`, o lo busca en `/v2/calls`).
  2. Busca la conversación en `/companies/{id}/conversations` → extrae nombre/dirección/carrier (`enhancedCallerId`).
  3. Match por `(brand_id, phone)` o crea lead nuevo con `assigned_rep_id: null` (pool, lo asigna el admin).
  4. Enriquece con ECID (`maybeEnrichLead`, hasta 50/run).
  5. `UPDATE calls SET lead_id`.

### 1.3 Toast en tiempo real + identificación — `incoming-call-toast.tsx` + `calls/actions.ts`
Lo que ve el rep cuando entra una llamada.

- El toast escucha `postgres_changes` (INSERT en `calls`) por Supabase Realtime.
- Si la llamada **no** trae lead, marca "identificando…" y llama al server action `identifyCaller(callId)`:
  1. Si ya tiene lead → devuelve nombre (sin costo).
  2. Match por teléfono → enlaza (sin costo).
  3. ECID lookup (cacheado = gratis; en vivo ≈ $0.05) → crea lead con nombre/dirección/carrier.
- Muestra: nombre o teléfono, estado del lead, saldo del plan activo, última cita, ciudad/estado/carrier.

### 1.4 El cliente de API — `src/lib/integrations/800com.ts`
- `GET /v2/calls` — historial (paginación por cursor, sleep 1100ms anti rate-limit 60/min).
- `GET /companies/{id}/conversations` — contactos con `enhancedCallerId` (nombre, ciudad, carrier, emails). Normaliza el cursor (`nextCursor` / `next_cursor` / `links.next`).
- `POST /v2/companies/{company}/ecid/lookups` — Enhanced Caller ID: dirección completa, lineType, emails. **Cacheado = gratis; en vivo = cobra.**
- `maybeEnrichLead` (`ecid-enrich.ts`): nunca lanza error, salta la API si ya hay `address_line1`, y solo llena campos vacíos (jamás sobreescribe).

### 1.5 Backfill manual (admin) — `admin/800com-webhook-register/backfill-actions.ts`
- `syncTrackingNumbersFromEightHundred` — registra los números en la BD (requisito para que el webhook resuelva).
- `backfillCallsFromEightHundred` — importa llamadas históricas (7 días default, hasta 200 páginas).
- `backfillLeadsForOrphanCalls` — como el cron pero ventana larga; `dryRun=true` por defecto (seguro).
- `syncContactsFromConversations` — sincroniza TODOS los contactos (incluye archivados) + ECID opcional; cuenta `ecid_lookups` / `ecid_charged`.

### 1.6 Secuencia exacta de una llamada entrante (evento por evento)

Esto es lo que pasa, en orden, desde que alguien marca un número de campaña hasta que el rep ve la info completa. Cada evento de 800.com llega como un POST separado al mismo webhook y toca la **misma fila** de `calls` (dedup por `external_id`).

```
  CLIENTE marca +1-888-307-3743 (número "Buses" de Si Se Pierde)
        │
        ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ T+0.0s   800.com → POST /api/webhooks/800com/voice?secret=…          │
 │          type: "call_started"                                        │
 │          data: { id: 998877, caller:"+17149260731",                  │
 │                  dialed:"+18883073743", numberId:416682,             │
 │                  isInbound:true, startedAt:"…" }                      │
 └─────────────────────────────────────────────────────────────────────┘
        │  el handler responde 200 { ok, accepted } AL INSTANTE
        │  y agenda el trabajo en after() (no bloquea a 800.com)
        ▼
   after() [T+0.1s aprox]
        │  1. dedup: ¿existe call con external_id=998877 + source=800com? → NO
        │  2. resolveTracking(numberId 416682):
        │       match por provider_metadata.number_id → tracking "Buses"
        │       → { brand_id: SiSePierde, rep_id: <rep activo>, tracking_number_id }
        │  3. dirección: isInbound===true → "inbound"
        │  4. findLeadByPhone(brand, +17149260731) → (normalmente NULL la 1ª vez)
        │  5. INSERT calls {
        │        external_id:"998877", source:"800com", direction:"inbound",
        │        outcome:NULL,            ← "sonando", aún sin resultado
        │        caller_e164:"+17149260731", dialed_e164:"+18883073743",
        │        tracking_number_id, brand_id, rep_id, lead_id:NULL,
        │        called_at, ringing_at }
        │
        ▼  el INSERT dispara Supabase Realtime (postgres_changes)
 ┌─────────────────────────────────────────────────────────────────────┐
 │ T+0.3s   NAVEGADOR del rep — incoming-call-toast.tsx                  │
 │          recibe el INSERT → enrichCall() → muestra TOAST + 🔔        │
 │          como lead_id=NULL: "identificando…" y llama                 │
 │          al server action identifyCaller(998877)                     │
 └─────────────────────────────────────────────────────────────────────┘
        │
        ▼  identifyCaller (en paralelo, mientras suena)
        │  a. ¿la call ya tiene lead? NO
        │  b. match por teléfono → NO  (es cliente nuevo)
        │  c. lookupEnhancedCallerId(+17149260731)  ← ECID
        │       cacheado = GRATIS · en vivo ≈ $0.05
        │       → { name:"Brian Franks", city, state, streetLine_1,
        │           postalCode, carrier, lineType, emails[] }
        │  d. crea LEAD (status:new, source:inbound_call,
        │       assigned_rep_id:NULL → pool) con esos datos
        │  e. UPDATE calls SET lead_id = <nuevo lead>
        │
        ▼
   EL TOAST se actualiza: "Brian Franks · Phoenix, AZ · Verizon"
   (el rep ya puede contestar con nombre y datos en pantalla)

        ────────── la llamada termina ──────────

 ┌─────────────────────────────────────────────────────────────────────┐
 │ T+45s    800.com → POST … type:"call_completed"                      │
 │          data:{ id:998877, result:"answered", duration:42, endedAt } │
 └─────────────────────────────────────────────────────────────────────┘
        │  after(): dedup encuentra la fila 998877 → UPDATE (no INSERT)
        │  outcome: "answered" → "connected"
        │  UPDATE calls SET outcome="connected", duration_seconds=42, ended_at
        ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ T+90s    800.com → POST … type:"call_decorated"                      │
 │          data:{ id:998877, recordingUrl:"https://…", transcription } │
 └─────────────────────────────────────────────────────────────────────┘
        │  after(): UPDATE misma fila
        │  UPDATE calls SET recording_url=…, transcription=…
        ▼
   /calls y /calls/[id] ya muestran: Brian Franks · inbound · connected ·
   0:42 · campaña "Buses" · grabación reproducible · transcript
```

**Puntos clave de la secuencia:**

- **Una sola fila, varios eventos.** `call_started` la crea; `call_completed` y `call_decorated` la actualizan por `external_id`. Nunca se duplica.
- **El toast no espera al cron.** La identificación (nombre/dirección) ocurre vía `identifyCaller` mientras el teléfono suena — no depende del cron de los 10 min.
- **Atribución desde el primer evento.** `dialed_e164` + `tracking_number_id` se escriben en el INSERT, así que la campaña (Buses/Radio/Billboard) se conoce desde que entra.
- **Si el ECID en vivo falla o no hay match**, la llamada igual queda capturada con `caller_e164`; el cron `auto-link-calls` reintenta el enlace/enriquecimiento después.
- **Red de seguridad.** Si por alguna razón no llega el webhook, el cron `poll-800com` (diario) y `backfillCallsFromEightHundred` (manual) recuperan la llamada por `external_id`.

**Caso saliente (outbound):** idéntico, salvo que `isInbound===false` → `direction="outbound"`, y el toast **no** se dispara (se ignoran salientes y llamadas que ya traen `outcome`).

---

## 2. Meta Lead Ads (formularios de Facebook)

- **Módulo:** `src/lib/integrations/meta-lead-ads.ts`.
- **Polling:** `src/app/api/agent/poll-meta-leads/route.ts` (cron-job.org cada 15 min; también cron Vercel diario).
- **Flujo:**
  1. Carga `tracking_forms` activos (`provider='meta'`).
  2. Sincroniza la estructura del formulario (preguntas) desde Graph API.
  3. Pagina todos los leads (cursor, 250ms entre páginas, lookback 90d).
  4. **Dedup en 3 capas:** `external_id`+`meta` → email → teléfono (normalizado a E.164, misma utilidad que 800.com para que casen con las llamadas).
  5. Merge en lead existente o crea nuevo (`status='new'`, `source='facebook'`).
- **Custom fields guardados:** `meta_lead_id, meta_form_id, meta_form_name, meta_ad_id/adset/campaign`, + cada pregunta personalizada.
- **Token:** `META_PAGE_ACCESS_TOKEN`. El "Data Access" caduca cada ~75–90 días. Si caduca, el endpoint devuelve **HTTP 500 + `META_TOKEN_EXPIRED`** para disparar la alerta de cron-job.org. **Renovación manual** (Graph API Explorer → actualizar env var en Vercel).

---

## 3. Modelo de datos (Supabase / Postgres)

### Tablas núcleo
| Tabla | Para qué | Relaciones clave |
|---|---|---|
| `users` | Cuentas + rol (admin/manager/rep/provider) | → brands |
| `brands` | Marcas/empresas (multi-tenant) | raíz |
| `user_brands` | Qué usuario ve qué marca (N:N) | → users, brands |
| `leads` | Prospectos (nombre, tel, email, dirección, status, source, `assigned_rep_id`, `external_id/provider`) | → brands, users |
| `calls` | Llamadas (dirección, outcome, duración, `caller_e164`, `dialed_e164`, `tracking_number_id`, `external_id`, recording, transcript) | → brands, leads, users |
| `tracking_numbers` | Números de campaña (`phone_e164`, `provider_metadata.number_id`, provider) | → brands |
| `appointments` | Citas (lead → rep → provider, tipo, status, `provider_approved`, `shipped_at`) | → brands, leads, users, clinics |
| `sales` | Ventas (amount_cents, payment_status/method, Stripe ids, paid_at) | → brands, leads, users, appointments |
| `sale_items` / `products` | Líneas de venta y catálogo | → sales, products, brands |
| `payment_plans` | Planes a plazos (total, installment_count, frequency_days, first_due_date, overrides JSON) | → leads, brands |
| `abonos` | Pagos individuales de un plan | → payment_plans, leads |
| `subscriptions` | Cobros recurrentes (Stripe) | → leads, products |
| `tasks` | Tareas asignables (priority, status, `related_lead_id`) | → users, leads |
| `clinics` | Ubicaciones de clínica | → brands |
| `lead_assignments` | Auditoría de reasignaciones | → leads, users |
| `notifications` / `notification_prefs` | Avisos y preferencias | → users |

### Tablas de IA
- **Agente:** `agent_runs`, `agent_actions`, `agent_pending_actions` (cola de aprobación, expira 7d), `agent_policies` (nivel de autonomía), `agent_goals`, `agent_skills`.
- **Conocimiento:** `knowledge_patterns`, `self_reflection_runs`, `skill_applications`.
- **Hermes:** `hermes_ticks`, `hermes_observations`, `hermes_resolutions`.

### Idempotencia / índices únicos
- `calls` UNIQUE (`external_id`, `source`) — evita llamadas duplicadas.
- `leads_brand_phone_uniq` — UNIQUE (`brand_id`, `phone`) — evita leads duplicados (se creó en esta inspección + se fusionaron 3 duplicados).
- Manejo de carreras: si choca el teléfono único, se enlaza al "ganador" de la carrera.

> Nota técnica: los tipos generados (`src/types/database.ts`) están **desactualizados** para `caller_e164`, `dialed_e164`, `tracking_number_id` y `external_id/provider` en leads → el código usa `(sb as any)`. Funciona, pero conviene regenerar tipos algún día.

---

## 4. Seguridad y acceso (RLS por rol + marca)

### Roles
`admin` (todo el sistema) · `manager` (todo dentro de su marca) · `rep` (solo lo suyo) · `provider` (solo leads de SUS citas).

| Recurso | Admin | Manager | Rep | Provider |
|---|---|---|---|---|
| Leads | todos | de la marca | `assigned_rep_id = yo` | solo vía sus `appointments` |
| Calls | todas | de la marca | propias | ✗ |
| Appointments | todas | de la marca | propias | propias |
| Sales / Payments | todas | de la marca | propias | ✗ |
| Shipping | ✓ | ✓ | ✗ | ✗ |
| Settings (marcas/usuarios/tracking) | ✓ | ✗ | ✗ | ✗ |

### Clientes de Supabase
- **Browser** (`anon key`) — RLS activa, Client Components.
- **Server** (`anon key` + cookie de sesión) — RLS activa, Server Actions/Components.
- **Admin** (`service role`) — **bypassa RLS**, solo para operaciones privilegiadas (settings, backfills, ejecución del agente) tras verificar el rol.

### Auth
- Supabase Auth (password / OTP para invitaciones). Sesión en cookie HttpOnly.
- Middleware (`src/middleware.ts`): redirige a `/login` si no hay sesión. `PUBLIC_PATHS` incluye `/api/agent/`, `/api/hermes/`, `/api/webhooks/`, `/api/cron/`, `/auth/confirm`.
- Marca activa en cookie `crm_brand_slug`.

---

## 5. La aplicación (páginas y qué hace cada una)

Todo bajo `src/app/(app)/`, con sidebar y acceso por rol.

- **`/dashboard`** — KPIs (llamadas, citas, ventas cobradas, pagos pendientes), citas de hoy, leads urgentes, insights de leads estancados, resumen del agente. Provider se redirige a `/appointments`.
- **`/leads`** — lista filtrable (status/source/búsqueda), export CSV, import (admin/mgr), import-plans, nuevo lead. Provider solo ve leads de sus citas.
- **`/leads/[id]`** — perfil + timeline cronológico (llamadas, citas, ventas), planes de pago con abonos, acciones de edición/reasignación. Provider solo ve citas y contacto.
- **`/leads/import-plans`** — sube Excel (hojas Plans + Payments), crea leads + planes + abonos; matchea rep por nombre.
- **`/calls`** y **`/calls/[id]`** — log de llamadas (fallback `caller_e164` cuando no hay lead), reproductor de grabación, transcript, atribución de campaña (tracking number).
- **`/appointments`** — citas (lead → rep → provider), estados, aprobación de provider, reasignación inline (admin/mgr).
- **`/sales`** (+ `/subscriptions`) — ingresos: vista por venta o por paciente, cobrado vs por cobrar, ticket promedio; abonos evitan doble conteo.
- **`/payments-due`** — próximos vencimientos de planes (calcula FIFO con overrides), barra de progreso, agregar abono.
- **`/shipping`** — (admin/mgr) citas aprobadas por provider sin enviar → "Marcar como enviado".
- **`/tasks`** — tareas por status/prioridad; rep ve las suyas.
- **`/settings`** — perfil, productos, marca, clínicas, usuarios, **tracking numbers** (pestañas según rol).
- **`/admin/*`** — registro de webhook 800.com, probes, backfills, ECID, insights del agente.

---

## 6. Bot interno (Claude) y Hermes

### Bot de consulta — `/api/agent/ask`
- Modelo `claude-sonnet-4-6`, máx 3 rondas de tools, historial de últimos 5 runs.
- **Tools de lectura** (`src/lib/agent/tools.ts`): `list_brands`, `get_leads`, `get_schedule_today`, `get_sales_kpi`, `get_calls_summary`, `get_tasks_open`.
  - **Rep-scoping:** `scopeRep(userId, role)` → admin/manager sin filtro; rep filtrado por `rep_id`/`assigned_rep_id`.
  - **Zona horaria:** "hoy" se resuelve en Pacific Time y se guarda en UTC.
  - `get_sales_kpi` soporta `payment_method` y `breakdown_by`; los abonos vinculados a planes no se doble-cuentan.
- **Tools de escritura** (`create_task`, `update_lead_status`, `log_call_note`): pasan por autonomía (`suggest_only` / `approve_required` / `auto_with_audit`) y la bandeja de aprobación (`agent_pending_actions`).
- **RAG** (`search_calls_semantic`, etc.) sobre transcripciones (requiere `OPENAI_API_KEY` para embeddings).
- **UI:** sin chat dedicado; se invoca en contexto (botón ⌘K), respuestas renderizadas inline + tarjeta de resumen diario + bandeja de pendientes.

> ⚠️ **Pendiente conocido (#11):** algunas tools devuelven `[]`/`{}` cuando la query falla, y el bot puede decir "$0"/vacío en vez de avisar del error. Cambiarlo toca el contrato de las tools (operación sensible) — aún no autorizado.

### Hermes — bot de auto-salud (`/api/hermes/tick`)
- **Ticks** periódicos → detecta **observaciones** (duplicados, salud del webhook, leads estancados) con severidad → aplica **resoluciones** automáticas si son seguras, o escala a humano (`requires_approval`).
- Tablas: `hermes_ticks`, `hermes_observations`, `hermes_resolutions`.

---

## 7. Crons y disparadores

**Vercel (`vercel.json`, UTC):**
| Ruta | Horario | Para qué |
|---|---|---|
| `/api/agent/reflect` | 07:00 | Detección de patrones del bot |
| `/api/agent/daily-insights` | 07:30 | Resúmenes diarios por rep |
| `/api/agent/poll-800com` | 08:00 | Importa llamadas (24h) |
| `/api/agent/transcribe-calls` | 08:15 | Transcribe + embebe audio |
| `/api/agent/poll-meta-leads` | 08:30 | Importa leads de Meta (90d) |

**cron-job.org (externos):**
| Ruta | Intervalo | Para qué |
|---|---|---|
| `/api/agent/poll-meta-leads` | 15 min | Ingesta casi-realtime de Facebook |
| `/api/cron/auto-link-calls` | 10 min | Enlaza llamadas huérfanas a leads |

---

## 8. Procedimientos operativos (memoria del proyecto)

- **Deploy:** `git push` → `npx vercel --prod --yes` → extraer URL → `npx vercel alias set <URL> proyectosagentic-crm.vercel.app` **y** `... agentic-crm-sigma.vercel.app`. (Rolling Releases NO auto-promueve el alias.)
- **Antes de cada commit:** `npx tsc --noEmit` debe pasar.
- **SQL en Supabase:** se MUESTRA el SQL, el usuario lo corre manualmente. Nunca ejecutar cambios de BD directo.
- **Cambios:** preferir aditivos; verificar tipos; si un cambio afecta una operación del CRM, revisar y ajustar antes de aplicar.
- **800.com #195485 (A&O)** es la cuenta master; "Si Se Pierde" es uno de los números dentro (3 tracking activos: Buses, Radio, Billboard).

---

## 9. Salud actual y pendientes

**Funcionando y verificado:**
- Captura de llamadas (webhook + cron + toast), con atribución de campaña (`dialed_e164` + `tracking_number_id`).
- Identificación en tiempo real del que llama (ECID, gratis-cuando-cacheado).
- Extracción completa de contactos (nombre, dirección, email, carrier) vía conversations + ECID.
- Dedup de leads cerrado en BD (`leads_brand_phone_uniq` + 3 duplicados fusionados).
- Meta Lead Ads activo con detección de token caducado.
- RLS sólida por rol + marca.

**Pendientes:**
- **#11** — bot que no diga "$0" cuando una tool falla (cambia contrato de tools, sin autorizar).
- Regenerar tipos de Supabase para quitar los `(sb as any)`.
- Verificar en Vercel: `INTERNAL_CRON_SECRET` y que los jobs de cron-job.org sigan activos.
- Opcional: SQL para mover leads viejos mal asignados al pool.

---

*Para revertir un deploy malo: `npx vercel alias set <deploy-anterior> proyectosagentic-crm.vercel.app`.*
