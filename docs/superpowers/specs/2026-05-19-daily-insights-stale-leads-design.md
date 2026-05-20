# Daily Insights v1: detección proactiva de leads sin contacto

**Fecha:** 2026-05-19
**Estado:** Borrador para review del usuario
**Sub-proyecto:** 2 del roadmap "Claude adentro del CRM" (orden 1→5→2→3→4)

## Contexto y problema

Hoy el rep abre el CRM y necesita acordarse de revisar la lista "Urgent leads" del dashboard para saber a quién hacer follow-up. Es una lista pasiva: si no la mira, se olvida.

El usuario quiere que el bot sea **proactivo**: que detecte solo lo que necesita atención y se lo diga apenas entra al CRM, con CTAs para actuar desde ahí. Frase textual del usuario: *"quisiera tener más control con la ayuda de Claude. Que fuera inteligente de que pudiera ver leads que hacen falta asignar, citas que están olvidados, etc."*

**v1 detecta UN solo tipo de insight: leads stale (sin contacto en ≥5 días).** Los demás insights del roadmap (citas olvidadas, planes vencidos, leads sin asignar) entran en sub-proyectos futuros — explícitamente fuera de scope para no inflar este sprint.

## Visión a largo plazo: "Claude adentro del CRM"

Este es el segundo paso del roadmap acordado el 2026-05-19 (5 sub-proyectos):

1. ✅ Reportes Excel + tool básica del bot (commit `882ce2e`, en producción)
2. **(este spec)** Bot proactivo / Daily Insights v1 (leads stale)
3. Query builder estructurado para el bot
4. Más write tools (`create_lead`, `schedule_appointment`, etc.)
5. Multi-step workflows con bulk approval

Este sub-proyecto entrega: el rep ve el insight apenas entra al CRM en 3 superficies sincronizadas (mensaje del bot, bell badge, panel dashboard) con CTAs accionables.

## Objetivos

1. Cada mañana a las 7 AM, el sistema detecta automáticamente leads stale por rep.
2. El rep entra al CRM y ve inmediatamente: (a) mensaje en `AgentSummaryCard`, (b) badge rojo en el bell con contador, (c) panel "Insights" en el dashboard con CTAs.
3. El rep puede actuar desde el panel sin navegar a otra pantalla (crear tarea de follow-up, marcar como contactado).
4. Si el rep no tiene leads stale, recibe un mensaje positivo ("Estás al día").

## No-objetivos (explícito)

- ❌ Citas sin confirmar / olvidadas (sub-proyecto futuro)
- ❌ Planes de pago con cuotas vencidas (sub-proyecto futuro)
- ❌ Leads nuevos sin asignar (sub-proyecto futuro)
- ❌ Threshold de "stale" configurable por rep (queda hardcoded `STALE_DAYS = 5`)
- ❌ Email / SMS / WhatsApp del resumen (solo in-app; los canales externos esperan integración Twilio de Fase 4 del otro roadmap)
- ❌ Personalización del prompt de Claude por marca (usa default genérico)
- ❌ Acciones bulk ("hacer X a los 5 leads") — solo individuales
- ❌ Insights "desde tu última visita" (no existe `users.last_seen_at`)
- ❌ Reemplazar el `UrgentLeadList` existente en el dashboard (sigue ahí, complementa)
- ❌ Notificaciones por evento real-time (Supabase realtime) — solo snapshots diarios del cron

## Arquitectura

### Flujo de datos

```
7:00 UTC diario
       │
       ▼
vercel.json cron → GET /api/agent/daily-insights
       │
       ▼
src/lib/agent/daily-insights.ts
  generateDailyInsightsForAllReps(sb)
       │
       ▼
Por cada user activo:
  detectStaleLeads(sb, repId, threshold=5d)
       │
       ▼
  Si stale.length > 0:
    DELETE notifications WHERE user_id=rep AND type IN ('daily_summary','stale_lead') AND DATE(created_at)=today
    INSERT notifications (type='daily_summary', body=template)              -- 1 fila
    INSERT notifications (type='stale_lead', related_lead_id=L.id) × N       -- N filas
  Si stale.length === 0:
    DELETE same
    INSERT notifications (type='daily_summary', body="Estás al día...")     -- 1 fila

      ─── Lectura (sin cambios al código existente) ───

dashboard/page.tsx (Server Component)
  ├── AgentSummaryCard ← fetchAgentSummary lee type='daily_summary'
  ├── DailyInsightsPanel (NUEVO en slot PHASE B) ← fetchStaleLeadsForRep
  └── UrgentLeadList (existente, se queda igual)

top-bar layout.tsx
  └── notification-bell ← getNotifications lee unread del user
       Click en un stale_lead → navigate /leads/{id}

      ─── Acción on-demand del rep ───

AgentSummaryCard botón "Regenerar"
  → regenerateAgentSummary (server action, HOY es no-op)
  → ahora: Claude genera texto natural con los stale leads del día
  → UPDATE notifications.body WHERE id=summary_id
```

### Componentes nuevos

#### 1. `src/lib/agent/daily-insights.ts` — Core logic

```typescript
const STALE_DAYS = 5
const MAX_BELL_LEADS_PER_REP = 20

export type StaleLead = {
  id: string
  first_name: string
  last_name: string | null
  brand_id: string
  brand_name: string
  days_stale: number  // null → más de 365, mostrar como "+365"
  last_contacted_at: string | null
}

export async function detectStaleLeads(
  sb: DB, repId: string, threshold: number = STALE_DAYS
): Promise<StaleLead[]>

export async function generateForRep(
  sb: DB, user: { id: string; name: string; brand_ids: string[] }
): Promise<{ summary_id: string; stale_count: number }>

export async function generateDailyInsightsForAllReps(
  sb: DB
): Promise<{ users_processed: number; total_insights: number; errors: { user_id: string; error: string }[] }>

/** Template determinístico (sin Claude). Bilingüe — usa la locale del user de notification_prefs o "es" default. */
export function buildSummaryTemplate(
  staleLeads: StaleLead[], locale: "es" | "en"
): { subject: string; body: string }

/** Sólo invocada por regenerateAgentSummary on-demand. Llama Claude. */
export async function buildSummaryWithClaude(
  staleLeads: StaleLead[], repName: string, locale: "es" | "en", anthropicClient
): Promise<{ subject: string; body: string }>
```

**Lógica de `detectStaleLeads`:**

Idéntica a la rama `staleQ` de `fetchUrgentLeads` (ver `src/lib/queries/dashboard.ts:314-321`):

```sql
select id, first_name, last_name, brand_id, last_contacted_at
from leads
where assigned_rep_id = $repId
  and status not in ('sold','lost')
  and (last_contacted_at is null or last_contacted_at < now() - interval '5 days')
order by last_contacted_at nulls first
limit 50  -- cap para evitar runaway
```

Después en código se calcula `days_stale = floor((now - last_contacted_at) / 86400000)` con `null → 9999` para "nunca contactado".

#### 2. `src/app/api/agent/daily-insights/route.ts` — Cron endpoint

```typescript
export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  // Auth: header CRON_SECRET (estándar Vercel) o public si se confía solo en obscurity
  // Service role client (necesario para iterar todos los users)
  // Llama generateDailyInsightsForAllReps(sb)
  // Devuelve JSON con stats: { users_processed, total_insights, errors }
}
```

**Protección del endpoint:** Vercel agrega header `Authorization: Bearer ${CRON_SECRET}` automáticamente a los crons declarados en `vercel.json`. Validamos eso (rechazar 401 si no matchea). Sin secret no se puede triggear manualmente desde afuera.

#### 3. `src/app/(app)/dashboard/_components/daily-insights-panel.tsx`

Card colapsable en el slot **PHASE B** (línea 163 de `dashboard/page.tsx`, entre greeting y `AgentSummaryCard`).

Estados visuales:
- **0 leads stale:** card colapsada con texto "✓ Estás al día". No molesta.
- **≥1 leads stale:** card expandida con tabla:
  - Filas: nombre lead (link `/leads/{id}`), días sin contacto, marca, acciones
  - Acciones inline: "Crear tarea follow-up" (botón → server action), "Marcar como contactado" (botón → actualiza `last_contacted_at = now()`)
- **Header siempre clickeable** para colapsar/expandir manualmente.

#### 4. Modificación de `src/app/(app)/dashboard/actions.ts → regenerateAgentSummary`

Hoy es no-op (comentario `// Phase 1: no-op — summary is generated by 8am cron only`). Ahora:

```typescript
export async function regenerateAgentSummary() {
  // 1) Detectar stale leads del user actual
  // 2) Llamar buildSummaryWithClaude(...)
  // 3) UPDATE notifications.body WHERE type='daily_summary' AND user_id=current AND DATE(created_at)=today
  // 4) revalidatePath("/dashboard")
}
```

Si Claude falla (timeout, rate limit, sin API key) → fallback al template y devolver `{ error: "Claude unavailable, used template" }`. NO romper la UX.

### Modificaciones al código existente

| Archivo | Cambio |
|---|---|
| `vercel.json` | Agregar cron `{ "path": "/api/agent/daily-insights", "schedule": "30 7 * * *" }` (30 min después del cron `/api/agent/reflect` existente para no sobreponerse) |
| `src/app/(app)/dashboard/page.tsx` | Agregar `<DailyInsightsPanel userId={user.id} />` en el slot PHASE B (línea 163) |
| `src/app/(app)/dashboard/actions.ts` | Implementar `regenerateAgentSummary` (hoy no-op) |
| `messages/es.json` y `en.json` | Agregar sección `dashboard.dailyInsights.*` con strings |

### Idempotencia del cron

**Crítico** porque Vercel puede retriggear el cron si falla. Patrón:

```sql
begin;
delete from notifications
where user_id = $rep_id
  and type in ('daily_summary','stale_lead')
  and date(created_at) = current_date;

insert into notifications (...) values (...);  -- summary
insert into notifications (...) values (...);  -- stale_lead × N
commit;
```

Resultado: si el cron corre 3 veces el mismo día, el estado final es el del último run. NO acumula notifications duplicadas. NO toca `read_at` de notifications de DÍAS anteriores.

### Multi-tenant / brand y qué users reciben insights

- El cron itera **users activos con `role IN ('rep','manager')`** — los admins NO reciben insights por default (típicamente no manejan leads asignados directamente).
- Por cada user, obtiene `user_brands.brand_id` (las brands a las que tiene acceso)
- `detectStaleLeads` filtra por `assigned_rep_id = user.id` — solo los leads asignados al user específico
- Si un manager tiene leads asignados (caso atípico), también recibe insights
- Si querés que los admins también reciban insights, basta cambiar el filtro de rol en una línea (queda como decisión de futuro)

### Seguridad

- **Cron endpoint:** valida `Authorization: Bearer $CRON_SECRET` (env var nueva en Vercel)
- **Service role:** necesario para iterar todos los users; OK porque corre desde un cron interno autenticado
- **Acciones inline del panel** (crear tarea, marcar contactado): usan cliente SSR del user → RLS filtra naturalmente
- **Notifications:** ya tienen RLS por `user_id` (el bell solo muestra las del user logueado)

### Errores y edge cases

- **Cron falla a mitad:** los reps procesados ya tienen sus notifications; el retry hace DELETE+INSERT, idempotente. La response del endpoint reporta `errors: [...]` para visibilidad.
- **User sin brands asignadas:** salta (no genera notification — no tiene leads que mirar).
- **User con 50+ leads stale (cap del query):** notification dice "50+ leads sin contactar — abrí Leads para ver todos". No bloquea.
- **Claude regenerate falla:** fallback al template, UI muestra warning sutil "no se pudo regenerar, mostrando template".
- **Lead se contacta DESPUÉS del cron:** el `stale_lead` notification queda hasta el día siguiente (es un snapshot). El rep puede marcarla como leída manualmente desde el bell. NO se borra automáticamente.
- **2 reps comparten lead** (futuro): el lead aparece para AMBOS reps si ambos tienen `assigned_rep_id = lead.id`. Por ahora `assigned_rep_id` es 1:1 así que no aplica.

### Performance

- Cron: itera N users (~10 reps actuales). Por user: 2-3 queries simples + 1-2 inserts batch. Total esperado: <5s para 10 reps. Cabe holgado en `maxDuration=60`.
- Dashboard load: agrega 1 query nueva (`fetchStaleLeadsForRep`) — ya hay ~13 queries en page load, una más no mueve la aguja.
- Regenerate on-demand: 1 query + 1 llamada Claude (~1-3s). Solo se dispara al clickear el botón.

### Costo

- **Cron diario:** Vercel cron es free (incluido en Hobby). Queries Supabase free hasta 500MB egress/mes. ~10 reps × ~30 inserts/día = 300 rows/día × 30 días = 9000 rows/mes. Despreciable.
- **Claude regenerate (on-demand):** ~$0.001 por click si Claude Sonnet 4.6, ~$0.003 si Opus. Si el rep clickea 1 vez al día, ~$0.03-0.10/mes por rep. Despreciable.

### Testing

- **Manual:** triggear el cron con `curl -H "Authorization: Bearer $CRON_SECRET" https://proyectosagentic-crm.vercel.app/api/agent/daily-insights` → verificar notifications insertadas en Supabase + dashboard muestra el panel + bell badge correcto.
- **Idempotencia:** correr el endpoint 3 veces seguidas → confirmar que el count de notifications del día NO crece.
- **Empty case:** rep sin leads stale → notification con texto "Estás al día" y panel colapsado.
- **Multi-brand:** rep con acceso a 2 brands → ve leads de las dos en el panel con columna "Marca".
- **Regenerate:** clickear botón Regenerar → texto cambia de template a versión Claude. Si Anthropic API falla, queda en template y se muestra warning.

### Strings nuevos i18n

Bajo `messages/{es,en}.json` → `dashboard.dailyInsights.*`:

```
title              "Insights del día" / "Today's insights"
collapsedAllGood   "✓ Estás al día"  / "✓ You're all caught up"
collapsedWithCount "{count} leads necesitan atención" / "{count} leads need attention"
columnLead         "Lead" / "Lead"
columnDays         "Días sin contacto" / "Days since contact"
columnBrand        "Marca" / "Brand"
columnActions      "Acciones" / "Actions"
actionFollowUp     "Crear follow-up" / "Create follow-up"
actionContacted    "Marcar contactado" / "Mark contacted"
templateBody       "Hola {name}. Tenés {count} leads sin contactar hace más de {days} días: {list}. Hacé follow-up hoy." / "Hi {name}. You have {count} leads not contacted in over {days} days: {list}. Follow up today."
templateBodyEmpty  "Hola {name}. Estás al día — no hay leads sin contactar." / "Hi {name}. You're all caught up — no stale leads."
regenerateFallback "No se pudo personalizar con IA, se mantiene el mensaje original." / "Could not personalize with AI, keeping original message."
```

### Cambios de DB

**Ninguno.** No hay migrations. La tabla `notifications` ya tiene todas las columnas. Solo se agrega un nuevo VALOR al campo `type` (string libre): `'stale_lead'`. `'daily_summary'` ya está en uso.

### Env vars nuevas

- **`CRON_SECRET`** — random string seguro, configurada en Vercel project settings. Vercel la inyecta automáticamente como header `Authorization: Bearer $CRON_SECRET` en los crons declarados. El endpoint valida el header.

Setup manual antes del primer deploy de este sub-proyecto:
1. Generar secret: `openssl rand -hex 32`
2. Settings → Environment Variables → Add `CRON_SECRET` para Production
3. Redeploy

## Archivos a crear/modificar

**Crear:**
- `src/lib/agent/daily-insights.ts` — core logic
- `src/app/api/agent/daily-insights/route.ts` — cron endpoint
- `src/app/(app)/dashboard/_components/daily-insights-panel.tsx` — UI panel
- `src/app/(app)/dashboard/_actions/daily-insights-actions.ts` — server actions del panel (crear tarea, marcar contactado)

**Modificar:**
- `vercel.json` — agregar el segundo cron
- `src/app/(app)/dashboard/page.tsx` — montar el panel en slot PHASE B (línea 163)
- `src/app/(app)/dashboard/actions.ts` — implementar `regenerateAgentSummary`
- `messages/es.json` + `en.json` — strings nuevos

## Estimación

**1.5-2 días:**
- 0.5 día: `daily-insights.ts` + `route.ts` + idempotencia + smoke test
- 0.25 día: `vercel.json` + setup `CRON_SECRET` + validación del header
- 0.5 día: `DailyInsightsPanel` UI + acciones inline
- 0.25 día: `regenerateAgentSummary` con Claude + fallback
- 0.25 día: i18n + smoke test full + commit + deploy

## Decisiones tomadas (defaults razonables, cambiar si querés)

| Decisión | Valor default |
|---|---|
| Threshold de stale | 5 días (match con `fetchUrgentLeads` existente) |
| Hora del cron | 7:30 UTC (escalonado 30 min después del cron existente `/api/agent/reflect` para no sobreponerse y dejar margen si reflect tarda) |
| Max stale leads por rep | 50 en query, 20 visibles en bell (más → "+20" en badge) |
| Panel colapsable | Sí. Expandido por default si hay leads stale, colapsado si no. |
| Locale del template | `es` default. Lee `notification_prefs.locale` si existe en el futuro. |
| Modelo Claude para regenerate | `claude-sonnet-4-6` (mismo que ask/route.ts) |

## Aprobación

- [ ] Spec revisado por usuario
- [ ] Aprobado para pasar a `writing-plans`
