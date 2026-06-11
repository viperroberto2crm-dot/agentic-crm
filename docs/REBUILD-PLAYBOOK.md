# REBUILD PLAYBOOK — agentic-crm
> Documento para Claude (el asistente). Si el código o el contexto se pierde, esto es el plan completo para **reconstruir el sistema sin parar**.
> No es marketing ni resumen: son instrucciones de ingeniería ejecutables, en orden, con invariantes críticos.
> Última verificación contra el código real: **2026-06-08**.

---

## 0. CÓMO USAR ESTE DOCUMENTO

1. Leé la sección **1 (Invariantes)** ANTES de tocar nada. Romper un invariante = romper producción.
2. Reconstruí en el **orden de la sección 3** (dependencias estrictas: nada de empezar por el webhook).
3. Cada subsistema tiene: archivos, contrato, env vars, y SQL si aplica.
4. Antes de cada commit: `npx tsc --noEmit`. Deploy según sección 9.
5. Si dudás de un dato (un id, un horario de cron, un nombre de columna): **verificá en el código**, no asumas. Este doc puede quedar desfasado.

---

## 1. INVARIANTES CRÍTICOS (no negociables)

1. **NO tocar `src/app/api/webhooks/800com/voice/route.ts` sin autorización explícita del usuario.** Históricamente romperlo cortó la captura de llamadas por horas. Un commit de auto-create-lead (`4370a576`) tuvo que revertirse (`9192369`). Si hay que cambiarlo: revisar, avisar, y tener el alias del deploy anterior listo para revertir.
2. **Antes de CADA commit:** `npx tsc --noEmit` debe pasar limpio.
3. **SQL en Supabase:** se MUESTRA el SQL al usuario, él lo corre manualmente en el dashboard. NUNCA ejecutar cambios de BD directo desde código/CLI.
4. **Deploy NO auto-promueve el alias** (Vercel Rolling Releases). Después de `vercel --prod` hay que `vercel alias set` a los DOS dominios (ver §9).
5. **Cambios aditivos > destructivos.** Verificar tipos cuando se pasan campos nuevos. Si un cambio afecta una operación del CRM, revisar y ajustar ANTES de aplicar.
6. **Idempotencia es sagrada:** toda ingesta (llamadas, leads) deduplica por clave externa. Nunca quitar los índices únicos ni los chequeos de dedup.
7. **`assigned_rep_id: null` = pool.** Los leads creados automáticamente (cron/webhook/toast) van al pool; el admin asigna. No auto-asignar al admin global.
8. **Idioma con el usuario: español, tono directo, SIN emojis.**
9. **Footer de commits:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## 2. STACK Y CONTEXTO DE NEGOCIO

- **Framework:** Next.js 15 App Router (Server Actions + Server Components). TypeScript.
- **BD/Auth/Realtime:** Supabase (Postgres). URL del proyecto: `https://cwsyhjxbyyakcbxcwhib.supabase.co`.
- **Hosting:** Vercel (Hobby + Rolling Releases). Dominios prod: `proyectosagentic-crm.vercel.app` y `agentic-crm-sigma.vercel.app`.
- **Modelo de negocio:** CRM de ventas+citas multi-marca. Pipeline: **Lead → Llamada → Cita → Venta → Pagos a plazos**.
- **Marcas:** multi-tenant. "Si Se Pierde" es la activa principal.
- **800.com:** cuenta master **A&O, companyId 195485**. "Si Se Pierde" son NÚMEROS dentro de esa cuenta. 3 tracking activos: **Buses, Radio, Billboard**.
- **Roles:** `admin` (todo) · `manager` (su marca) · `rep` (lo suyo) · `provider` (solo leads de sus citas).

---

## 3. ORDEN DE RECONSTRUCCIÓN (dependencias)

```
1. Supabase: esquema + RLS + índices únicos          (todo depende de esto)
2. Clientes Supabase (browser/server/admin) + Auth + middleware
3. Modelo de tipos (database.ts) + casts (sb as any) para columnas nuevas
4. App shell: layout, sidebar, brand context, role guards
5. Páginas CRUD core: leads, calls, appointments, sales, payment-plans, tasks
6. Integración 800.com: cliente API → tracking_numbers → webhook → toast realtime
7. Enriquecimiento: ECID (ecid-enrich) + cron auto-link-calls + backfills admin
8. Meta Lead Ads: módulo + poll cron + tracking_forms
9. Bot interno (/api/agent/ask + tools) + autonomía/aprobaciones
10. Hermes (auto-salud) + crons restantes
11. Exports/reportes
```
Razón del orden: el webhook (paso 6) necesita `tracking_numbers` registrados, que necesitan `brands` y el esquema (paso 1). El toast necesita Realtime + `identifyCaller` (paso 6) que necesita ECID (cliente, paso 6). El bot (paso 9) consulta tablas de los pasos 1–8.

---

## 4. ENV VARS (todas las que el sistema espera)

```bash
# --- Supabase ---
NEXT_PUBLIC_SUPABASE_URL=https://cwsyhjxbyyakcbxcwhib.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon>
SUPABASE_SERVICE_ROLE_KEY=<service role — SOLO server, bypassa RLS>

# --- App ---
NEXT_PUBLIC_SITE_URL=https://proyectosagentic-crm.vercel.app   # usado para registrar el webhook
NEXT_PUBLIC_APP_URL=https://proyectosagentic-crm.vercel.app

# --- 800.com ---
EIGHTHUNDRED_API_KEY=<bearer>
EIGHTHUNDRED_COMPANY_ID=195485
EIGHTHUNDRED_WEBHOOK_SECRET=<secreto del query param ?secret=>

# --- Crons internos ---
CRON_SECRET=<bearer para /api/cron/* y algunos /api/agent/*>
HERMES_SECRET=<bearer alterno aceptado por auto-link-calls y hermes>
INTERNAL_CRON_SECRET=<verificar que esté seteado en Vercel>

# --- Meta Lead Ads ---
META_PAGE_ACCESS_TOKEN=<long-lived; el "Data Access" caduca ~75-90 días>
META_APP_ID=953569784109558

# --- IA ---
ANTHROPIC_API_KEY=<para el bot /api/agent/ask, modelo claude-sonnet-4-6>
OPENAI_API_KEY=<solo para embeddings RAG de transcripciones>
```

---

## 5. SUPABASE — ESQUEMA, RLS, ÍNDICES

### 5.1 Tablas (columnas que el código USA — no exhaustivo del DDL)
- **users**: id, email, name, role (`admin|manager|rep|provider`), default_brand_id→brands, cell_phone, avatar_url, active.
- **brands**: id, slug, name, brand_color, logo_url, reply_email, whatsapp_number, active.
- **user_brands**: user_id→users, brand_id→brands. (N:N de visibilidad).
- **leads**: id, brand_id, first_name, last_name, phone, phone_alt, email, status (enum lead_status), source (enum lead_source, incluye `facebook`), assigned_rep_id→users (NULL=pool), notes, address_line1/2, city, state, zip, custom_fields(jsonb), ai_score, **external_id**, **external_provider**, created_by, last_contacted_at.
- **calls**: id, brand_id, lead_id→leads(NULL ok), rep_id→users, direction (enum call_direction), outcome (enum call_outcome, nullable), duration_seconds, notes, source, **external_id**, recording_url, transcript_text/transcription, ai_summary, ai_extracted(jsonb), called_at, ringing_at, ended_at, **caller_e164**, **dialed_e164**, **tracking_number_id**→tracking_numbers.
- **tracking_numbers**: id, brand_id, phone_e164, label, campaign, provider (`800com|...`), provider_metadata(jsonb: `{number_id:int, company_id:int}`), active.
- **appointments**: id, brand_id, lead_id, rep_id, provider_id→users, type (`clinic|home|telehealth`), status (enum), clinic_id→clinics, address_*, telehealth_link, service, scheduled_at, duration_minutes, notes, provider_approved(bool), provider_notes, shipped_at, reminder_sent_at.
- **sales**: id, brand_id, lead_id, rep_id, appointment_id, amount_cents, currency, payment_method (`cash|card|stripe`), payment_status (enum), card_last4, stripe_payment_intent_id, stripe_checkout_session_id, product, notes, paid_at.
- **sale_items**: id, sale_id, product_id, product_name, product_category, cadence, quantity, unit_price_cents, discount_cents, line_total_cents.
- **products**: id, brand_id, name, category, sku, price_cents, display_price_cents, display_unit, cadence, billing_cycle_days, recurring, included_services(jsonb), best_value, active, sort_order.
- **payment_plans**: id, lead_id, brand_id, sale_id, product_name, total_amount_cents, installment_count(NULL=lump-sum, no aparece en payments-due), installment_amount_cents, frequency_days, first_due_date, installment_overrides(jsonb: por cuota `{due_date,amount_cents,deleted}`), created_by.
- **abonos**: id, plan_id→payment_plans, lead_id, brand_id, amount_cents, paid_at, payment_method, notes, recorded_by.
- **subscriptions**: id, brand_id, lead_id, product_id, initial_sale_id, cadence, billing_cycle_days, amount_cents, status, started_at, next_billing_at, cancelled_at, stripe_subscription_id.
- **tasks**: id, brand_id, assigned_to→users, related_lead_id→leads, title, description, due_at, priority (enum), status (`open|done|snoozed|cancelled`), source, agent_action_id.
- **clinics**: id, brand_id, name, address_*, phone, active.
- **lead_assignments**: id, lead_id, from_rep_id, to_rep_id, assigned_by, reason. (auditoría).
- **notifications / notification_prefs**: avisos por canal + preferencias por usuario.
- **tracking_forms** (Meta): id, brand_id, provider(`meta`), external_form_id, external_page_id, name, campaign, active, provider_metadata(jsonb: `questions[]` con `{key,label,crm_field}`).
- **IA — agente:** agent_runs, agent_actions, agent_pending_actions (status `pending|approved|rejected|executed|expired`, expira 7d), agent_policies (autonomy_level `suggest_only|approve_required|auto_with_audit`), agent_goals, agent_skills.
- **IA — conocimiento:** knowledge_patterns (con embedding), self_reflection_runs, skill_applications.
- **IA — Hermes:** hermes_ticks, hermes_observations (severity info|warning|critical), hermes_resolutions (status success|failed|requires_approval|approved_by_human|rejected).

### 5.2 Enums (en database.ts)
```
appointment_status: scheduled|confirmed|completed|cancelled|no_show|rescheduled
appointment_type: clinic|home|telehealth
autonomy_level: suggest_only|approve_required|auto_with_audit
call_direction: inbound|outbound
call_outcome: no_answer|voicemail|connected|appointment_set|not_interested|callback_requested|wrong_number
lead_source: inbound_call|web_form|referral|whatsapp|walk_in|social|other|facebook
lead_status: new|contacted|qualified|appointment_set|sold|lost|on_hold|not_interested
payment_method: cash|card|stripe
payment_status: pending|paid|failed|refunded|partial
pending_status: pending|approved|rejected|executed|expired
task_priority: low|normal|high|urgent
task_status: open|done|snoozed|cancelled
user_role: admin|manager|rep|provider
```

### 5.3 Índices únicos / idempotencia (CRÍTICO)
```sql
-- Llamadas: una fila por llamada de 800.com
CREATE UNIQUE INDEX IF NOT EXISTS calls_external_source_uniq
  ON calls (external_id, source) WHERE external_id IS NOT NULL;

-- Leads: no duplicar por teléfono dentro de una marca
CREATE UNIQUE INDEX IF NOT EXISTS leads_brand_phone_uniq
  ON leads (brand_id, phone) WHERE phone IS NOT NULL;
```
> Si hay duplicados previos que impiden crear el índice: fusionar primero. TODAS las FKs hacia leads son `ON DELETE CASCADE`, pero para fusionar (no borrar datos) hay que re-apuntar las referencias con UPDATEs antes de borrar el duplicado: `calls.lead_id`, `appointments.lead_id`, `sales.lead_id`, `payment_plans.lead_id`, `abonos.lead_id`, `tasks.related_lead_id`, `lead_assignments.lead_id`, `subscriptions.lead_id`, `notifications.related_lead_id`, etc. Verificar la lista real de FKs antes (consultar `information_schema`), no asumir.

### 5.4 RLS (modelo)
- Aplicación filtra por rol + brand + user_id (además de policies en BD).
- **rep:** `leads.assigned_rep_id = uid`, `calls.rep_id = uid`.
- **provider:** allowlist de lead_ids calculada desde `appointments.provider_id = uid` (no ve calls/sales/plans).
- **manager/admin:** sin filtro de rep (admin cross-brand, manager scoped a su brand).
- **middleware** (`src/middleware.ts`): redirige a `/login` sin sesión. `PUBLIC_PATHS` incluye `/api/agent/`, `/api/hermes/`, `/api/webhooks/`, `/api/cron/`, `/api/admin/800com/`, `/auth/confirm`. Server Actions (header `Next-Action`) saltan el redirect.

---

## 6. INTEGRACIÓN 800.com — RECONSTRUCCIÓN DETALLADA

### 6.1 Cliente API — `src/lib/integrations/800com.ts`
- **`GET /v2/calls`** (`listCallsPage`): cursor-based, `perPage<=100`, sleep **1100ms** entre páginas (rate limit 60/min). Campos del call: `id, caller, dialed, direction, isInbound, status, result, startedAt/answeredAt/endedAt, duration, number:{id,number,label}, recordingUrl, transcription`.
- **`GET /companies/{id}/conversations`** (`listConversationsPage`): contactos con `enhancedCallerId` (firstName, lastName, city, state, country, carrier, addressLine1, zipCode, emails[]). **Normalizar cursor:** `nextCursor ?? next_cursor ?? (links.next → parse ?cursor=)`. Sin esto solo paginaba 1 página.
- **`POST /v2/companies/{company}/ecid/lookups`** (`lookupEnhancedCallerId(phone, forceLive=false)`): Enhanced Caller ID completo (name, streetLine_1/2, city, region, postalCode, carrier, lineType, emails[]). Devuelve `{matchStatus, data, cacheHit, normalizedPhone}`. **cacheHit=true → gratis; en vivo → cobra (~$0.05).**
- **`normalizeToE164(phone)`**: 10 dígitos → +1; quita no-dígitos. Compartida con Meta para que los teléfonos casen.
- **`extractEnhancedCallerInfo`**: debe devolver firstName, lastName, middleName, city, state, addressLine1, **addressLine2, email, country, carrier, zipCode** (no solo nombres).
- **`getFallbackRepId`**: query con `.in("users.role", ["rep","manager","admin"])` para **excluir providers**.
- **`importCallsFromEightHundred(sb, {startDate,endDate,autoCreateLeads=true,maxPages=50})`**: dedup por external_id, match/crea lead, normaliza, INSERT calls.

### 6.2 tracking_numbers (prerequisito del webhook)
Registrar con `syncTrackingNumbersFromEightHundred` (admin): pagina `/v2/calls`, extrae `number.id` únicos, INSERT `{provider:'800com', brand_id, phone_e164, label, provider_metadata:{number_id}, active:true}`. **Sin esto el webhook no resuelve la marca.**

### 6.3 Webhook receiver — `src/app/api/webhooks/800com/voice/route.ts` (PROTEGIDO)
Contrato exacto (reconstruir idéntico):
1. Auth por `?secret=` == `EIGHTHUNDRED_WEBHOOK_SECRET`.
2. Responder `200 {ok:true, accepted:true}` inmediato; trabajo en **`after()`** con try/catch.
3. `handleCallEvent`:
   - dedup: `calls.select(...).eq(external_id).eq(source,'800com').maybeSingle()`. Existe → UPDATE; no → INSERT.
   - **outcome map:** answered→connected, voicemail→voicemail, missed/hungup→no_answer, null→null.
   - **resolveTracking(numberId, dialedE164):** carga tracking_numbers activos 800com → match por `provider_metadata.number_id` → fallback por sufijo de `phone_e164` vs dialed → rep = primer rep/manager/admin activo del brand, else admin más antiguo → `{brand_id, rep_id, tracking_number_id}`.
   - **dirección:** `isInbound===true || direction==="inbound" || (isInbound===undefined && direction===undefined)`; si `isInbound===false` → outbound.
   - **findLeadByPhone(brand, callerE164):** exact en `phone`, fallback `phone_alt`.
   - **INSERT payload:** brand_id, lead_id(o null), rep_id, direction, outcome, duration_seconds, caller_e164, **dialed_e164**, **tracking_number_id**, source:'800com', external_id:String(id), recording_url, called_at, ringing_at, transcription.
   - Race en INSERT duplicado → tratar como OK.
- Registro del webhook (`admin/800com-webhook-register/actions.ts`): URL = `${NEXT_PUBLIC_SITE_URL}/api/webhooks/800com/voice?secret=...`, method POST, features `[call_started, call_completed, call_decorated, call_updated]`. NO usar `VERCEL_URL` (deployment-protected → 401).

### 6.4 Enriquecimiento — `src/lib/integrations/ecid-enrich.ts`
`maybeEnrichLead(sb, leadId)`: **nunca lanza**. Salta API si `address_line1` ya está. Solo llena campos vacíos (first_name si parece teléfono, last_name, email, address_line1/2, city, state, zip). Usa `lookupEnhancedCallerId(phone, false)` (cacheado, sin cobro). Este es el camino probado de extracción completa.

### 6.5 Cron de enlace — `src/app/api/cron/auto-link-calls/route.ts`
Auth Bearer CRON_SECRET/HERMES_SECRET. `?days=N` (default 1). Topes `ORPHANS_LIMIT=500, CONV_MAX_PAGES=5, MAX_ENRICH=50`. Por huérfana (`lead_id IS NULL, source=800com`): resolver teléfono (caller_e164 → /v2/calls) → conversación → match `(brand,phone)` o crear lead `assigned_rep_id:null` + address/email → `maybeEnrichLead` → `UPDATE calls SET lead_id`.

### 6.6 Toast realtime — `src/components/incoming-call-toast.tsx` + `calls/actions.ts:identifyCaller`
- Suscripción `postgres_changes` INSERT en `calls`. Saltar si outbound o ya tiene outcome.
- `enrichCall`: lee `caller_e164` (cast `(call as CallRow & {caller_e164})`), brand, lead, plan activo, última cita.
- Sin lead → `identifying:true` + `identifyCaller(callId)`: ya-tiene-lead → nombre; match teléfono → enlaza; ECID → crea lead (idempotente, race-safe) → UPDATE call. Devuelve {leadId,name,city,state,address,carrier,lineType,created}.

---

## 7. META LEAD ADS — `src/lib/integrations/meta-lead-ads.ts`
- `importMetaLeadsToCrm(sb, {sinceTimestamp, maxLeadsPerForm})`: por cada `tracking_forms` activo (provider=meta): `syncFormStructure` (refresca preguntas) → `iterAllLeads(formId)` (cursor, 250ms/página, lookback 90d) → `decodeFieldData` (firstName/lastName/email/phone normalizado + customFields) → dedup 3 capas: `findLeadByMetaId` → `findLeadByEmail(brand)` → `findLeadByPhone(brand)` → merge o crea (`status:new, source:facebook`).
- Merge preserva nombre/tel/email existentes; agrega nota con fecha+form+Q&A; guarda `meta_*` en custom_fields. No enriquece ECID (Meta ya trae datos; evita rate limit 800.com).
- Poll: `src/app/api/agent/poll-meta-leads/route.ts`. Auth Bearer CRON_SECRET. `?days=N` (1..90, default 90). **Detección de token caducado:** match en error de `OAuthException|code 190|access token|expired|session has been invalidated` → HTTP **500 + {alert:'META_TOKEN_EXPIRED'}** para disparar alerta de cron-job.org. Renovación: Graph API Explorer → nuevo token → actualizar `META_PAGE_ACCESS_TOKEN` en Vercel.

---

## 8. BOT INTERNO + HERMES
- **`/api/agent/ask`**: Anthropic `claude-sonnet-4-6`, max_tokens 1024, ≤3 rondas de tools, historial últimos 5 runs + compaction. System prompt `CRM_SYSTEM_PROMPT` (locale es/en hard-lock). Persiste en agent_runs/agent_actions.
- **Tools lectura** (`src/lib/agent/tools.ts`): `list_brands, get_leads, get_schedule_today, get_sales_kpi, get_calls_summary, get_tasks_open`.
  - `scopeRep(uid, role)`: admin/manager→null (sin filtro); rep→uid.
  - Timezone `America/Los_Angeles`: "hoy" en PT, guardado UTC (`todayInTz`, `dayStartUtcInTz`).
  - `get_sales_kpi`: soporta `payment_method` y `breakdown_by`; abonos de planes no se doble-cuentan; rep ve solo sus ventas + planes vía `payment_plans.sale_id→rep`.
  - `get_calls_summary`: CONNECTED_OUTCOMES = {connected, appointment_set, callback_requested, not_interested}; `group_by_source` por label de tracking.
- **Tools escritura** (`create_task, update_lead_status, log_call_note`): pasan por `resolveAutonomy(brand,user,actionType)` → suggest_only/approve_required/auto_with_audit → bandeja `agent_pending_actions` (approve/reject por admin/manager, ejecuta `executeWriteTool`).
- **RAG** (`search_calls_semantic`, `get_call_evidence_for_lead`): embeddings OpenAI sobre transcripciones.
- **UI:** sin chat dedicado; botón ⌘K, `agent-message.tsx` (markdown ligero propio), `agent-summary.tsx` (dashboard), `agent-pending-tray.tsx`.
- **Hermes** (`src/lib/hermes/*`, `/api/hermes/tick`): ticks → observations (duplicados, salud webhook, leads estancados) → resolutions (auto si `is_safe`, else `requires_approval`).

> **DEUDA #11 (no resuelto, no autorizado a cambiar):** varias tools devuelven `[]`/`{}` ante error de DB → el bot dice "$0"/vacío en vez de avisar. Arreglarlo cambia el contrato de retorno de las tools (operación sensible). Pedir autorización antes.

---

## 9. DEPLOY (procedimiento exacto)
```bash
npx tsc --noEmit                       # debe pasar
git add -A && git commit -m "...
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push                               # si se backgroundea: verificar con `git log origin/master..master`
npx vercel --prod --yes                # extraer la URL del deploy del output
npx vercel alias set <URL> proyectosagentic-crm.vercel.app
npx vercel alias set <URL> agentic-crm-sigma.vercel.app
```
**Revertir un deploy malo (rollback en 1 comando):**
```bash
npx vercel alias set <DEPLOY-ANTERIOR> proyectosagentic-crm.vercel.app
```

---

## 10. CRONS (configurar)
**Vercel `vercel.json` (UTC):**
| Ruta | Horario |
|---|---|
| /api/agent/reflect | 0 7 * * * |
| /api/agent/daily-insights | 30 7 * * * |
| /api/agent/poll-800com | 0 8 * * * |
| /api/agent/transcribe-calls | 15 8 * * * |
| /api/agent/poll-meta-leads | 30 8 * * * |

**cron-job.org (externos, manual):**
| Ruta | Intervalo |
|---|---|
| /api/agent/poll-meta-leads | 15 min |
| /api/cron/auto-link-calls | 10 min |

Auth de todos: header `Authorization: Bearer <CRON_SECRET>` (auto-link acepta también HERMES_SECRET).

---

## 11. HISTORIAL DE DECISIONES (para no repetir errores)
- **Captura nunca estuvo rota** durante la última crisis; el problema era `caller_e164` no almacenado + lag en resolución de nombre. Solución: guardar `caller_e164` + identificación ECID en tiempo real. NO re-introducir auto-create-lead en el webhook.
- El reverted auto-create NO falló por columnas faltantes ni por timeout (ambas hipótesis se descartaron). Causa raíz nunca confirmada → por eso enfoque "receiver-safe".
- El endpoint de **conversations solo trae `city`**, NO la calle. La dirección completa viene de **ECID** o del webhook `call_decorated`. El camino import (`createLeadFromCall → maybeEnrichLead`) ya hacía extracción completa; el cron no llamaba `maybeEnrichLead` → se corrigió.
- Lote A: fix leak de abonos en scope de rep, enum de status alineado a DB, connection_rate con set de outcomes. Lote B: leads automáticos al pool (`assigned_rep_id:null`), `updateLead` quita `assigned_rep_id` del payload para rol rep. Lote C: fix dirección (#5), guardar dialed_e164+tracking_number_id (#9), rep fallback por brand (#6).

---

## 12. CHECKLIST DE VERIFICACIÓN POST-REBUILD
- [ ] `npx tsc --noEmit` limpio.
- [ ] Login funciona; middleware redirige; PUBLIC_PATHS correctos.
- [ ] Índices únicos `calls_external_source_uniq` y `leads_brand_phone_uniq` existen.
- [ ] tracking_numbers registrados (Buses/Radio/Billboard) con `provider_metadata.number_id`.
- [ ] Webhook registrado en 800.com apuntando al alias prod con `?secret=`.
- [ ] Llamada de prueba: aparece en /calls con `action=inserted`, dirección correcta, dialed_e164 + tracking, y el toast identifica al caller.
- [ ] Cron auto-link-calls enlaza huérfanas. poll-meta-leads importa y detecta token caducado.
- [ ] Bot responde con datos reales y respeta rep-scoping.
- [ ] RLS: un rep no ve leads/calls de otro; provider solo ve sus citas.
- [ ] Deploy aliaseado a los DOS dominios.
```
```
