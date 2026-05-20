# Reportes Excel multi-hoja + Tool del bot para generarlos

**Fecha:** 2026-05-19
**Estado:** Borrador para review del usuario
**Sub-proyecto:** 1 de 5 en el roadmap "Claude adentro del CRM"

## Contexto y problema

Hoy el botón **Export** en `/sales` genera un CSV plano que solo incluye filas de la tabla `sales`. El cliente lo abre y ve "$0 cobrado / $0 pendiente" en sus totales porque la plata que entra como **abonos de payment plans** (lo más relevante para el caso de uso real de Si Se Pierde / SunnySlim) no aparece — vive en una tabla separada y el export no la cruza.

Paralelamente, el cliente le pide al bot del CRM "mandame un Excel con las ganancias totales y lo que deben los pacientes" y el bot solo responde con texto. No tiene capacidad de generar archivos.

**Resultado actual:** el cliente está bloqueado. El reporte que exige no se puede generar desde el CRM.

## Visión a largo plazo: "Claude adentro del CRM"

Este spec es el **primer paso de un plan en 5 sub-proyectos** acordado el 2026-05-19:

1. **(este spec)** Reportes Excel + tool básica del bot para generarlos
2. Bot proactivo / Daily Insights (detectar leads sin asignar, citas olvidadas, planes vencidos)
3. Query builder estructurado para el bot (consultar cualquier entidad)
4. Más write tools (`create_lead`, `create_sale`, `schedule_appointment`, etc.)
5. Multi-step workflows con aprobación bulk

Sumadas las 5, el resultado es un Claude embebido que: **lee** cualquier dato, **escribe** con aprobación humana, **genera** archivos, y **trabaja proactivo**. Cada sub-proyecto entrega valor independiente.

Este sub-proyecto entrega: el cliente puede generar el Excel exigido, y el bot adquiere su primera capacidad de devolver artefactos descargables (no solo texto).

## Objetivos de este spec

1. El botón Export en `/sales` produce un `.xlsx` real (no CSV) con 3 hojas que incluyen cobrado/pendiente correctamente.
2. El bot puede generar el mismo reporte cuando se lo piden en lenguaje natural, con filtros opcionales (rango, marca, rep, status), y devuelve link descargable.
3. La separación de marcas es flexible: el usuario elige "Todas" (combinado con columna marca) o una específica.

## No-objetivos (explícito, para evitar scope creep)

- ❌ Query builder libre del bot (sub-proyecto #3)
- ❌ Multi-hojas separadas por marca (`Resumen SiSePierde` + `Resumen SunnySlim`) — el cliente puede filtrar la columna marca en Excel
- ❌ Programar envío automático del reporte por email/WhatsApp (entra cuando esté Stripe + email provider, Fase 5 del roadmap)
- ❌ Gráficos dentro del Excel (puro tabular)
- ❌ Export a PDF
- ❌ HIPAA scrubbing del Excel (los reportes incluyen nombres; HIPAA está pospuesto por decisión del usuario)
- ❌ Reemplazar el endpoint actual `/api/exports/sales` (queda como legacy CSV por ahora, no rompemos nada)
- ❌ TTL / cleanup automático de archivos en bucket `reports/`. Los archivos se acumulan; las signed URLs vencen en 24h pero el archivo queda. **TODO para sub-proyecto futuro:** cron diario que borre archivos >7 días. Por ahora es un costo bajo (xlsx pesa <1MB típico) y aceptable.

## Arquitectura

### Componentes

1. **Endpoint nuevo `GET /api/exports/report`** (Node runtime, no Edge — necesita `xlsx` que ya está en deps)
   - Genera un workbook .xlsx en memoria con 3 hojas usando `xlsx`
   - Lee datos respetando RLS (cliente Supabase SSR del user actual)
   - Devuelve binary stream con `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

2. **Componente cliente `ReportExportDialog`** en `src/components/exports/`
   - Reemplaza/coexiste con el `ExportButton` actual en `/sales/page.tsx`
   - Selector marca + rango + checkbox "Todo el histórico"
   - Al confirmar: descarga el .xlsx vía anchor transient (mismo patrón que el botón actual)

3. **Tool nueva del bot `generate_sales_report`** en `src/lib/agent/file-tools.ts` (archivo nuevo, paralelo a `tools.ts` y `write-tools.ts`)
   - Parámetros opcionales (LLM mapea de NL): `from`, `to`, `brand`, `rep_name`, `status`, `historico`
   - Llama internamente al endpoint con privilegios del user actual
   - Sube el archivo a Supabase Storage en bucket privado `reports/` con URL firmada (24h)
   - Devuelve al bot: `{ download_url, expires_at, filename, summary }`

4. **Bucket nuevo en Supabase Storage** `reports`
   - Privado (no público)
   - Política RLS: solo el owner del archivo puede leerlo (path: `userId/timestamp_filename.xlsx`)
   - URL firmada se genera con expiración 24h

5. **Helper de queries `buildReportData`** en `src/lib/exports/report-data.ts`
   - Función pura que recibe `{ brandId?, from?, to?, status?, repId? }` y devuelve `{ resumenPorPaciente[], transacciones[], kpis }`
   - Usado por AMBOS el endpoint y la tool del bot — single source of truth
   - Internamente cruza `sales` + `payment_plans` + `abonos` (tabla real, en español — verificado en `src/app/(app)/leads/[id]/actions.ts:414-451`)
   - **Reusa** `getSalesBreakdown` de `src/lib/queries/sales-kpi.ts` para los KPIs (esa función ya excluye correctamente sales auto-generadas y suma abonos)
   - **Extrae** y reusa la lógica de `src/app/(app)/leads/[id]/page.tsx:106-132` que ya implementa el cálculo anti-doble-conteo por paciente

### Flujo de datos

```
Botón Export (UI)            Bot (NL)
       │                        │
       ▼                        ▼
ReportExportDialog       generate_sales_report tool
       │                        │
       └────────┬───────────────┘
                ▼
       /api/exports/report
                │
                ▼
       buildReportData()
                │
   ┌────────────┼────────────┐
   ▼            ▼            ▼
 sales    payment_plans   abonos
 (RLS)      (RLS)          (RLS)
                │
                ▼
       xlsx workbook 3 hojas
                │
       ┌────────┴────────┐
       ▼                 ▼
   Browser download   Supabase Storage
   (botón)            (bot → link firmado)
```

### Estructura del Excel

**Hoja 1 — "Resumen por paciente"**

Una fila por lead con ≥1 venta O ≥1 payment plan en el periodo (o histórico si `historico=true`):

| Columna | Tipo | Cálculo |
|---------|------|---------|
| Marca | string | `brands.name` del lead |
| Lead | string | `first_name + " " + last_name` |
| Email | string | `leads.email` |
| Teléfono | string | `leads.phone` |
| Rep | string | `users.name` (assigned_rep) |
| # Ventas | number | count de `sales` standalone del lead en periodo (excluye sales auto-generadas por planes) |
| Total contratado | currency USD | ver "Reglas anti-doble-conteo" abajo |
| Total cobrado | currency USD | ver "Reglas anti-doble-conteo" abajo |
| Saldo pendiente | currency USD | `Total contratado - Total cobrado` |
| Próxima cuota (fecha) | date | calculada en runtime: `plan.first_due_date + n * plan.frequency_days` (aplicando `installment_overrides`) — primera cuota futura no pagada |
| Próxima cuota ($) | currency USD | `plan.installment_amount_cents` (o override si existe) |
| Status | string | "Al día" / "Atrasado N días" / "Plan completo" / "Sin plan" |

**Reglas anti-doble-conteo (críticas — el bug que este feature debe arreglar es exactamente este):**

El error del export viejo era no entender que `payment_plans` apunta a una `sale` (campo `payment_plans.sale_id`). Esa sale es "auto-generada" como contenedor del plan y queda con `payment_status='partial'`. Si sumás `sales.amount_cents` directo, dobla el monto del plan.

Aplicar esta lógica (extraída de `src/app/(app)/leads/[id]/page.tsx:106-132`):

1. Obtener `planSaleIds = SELECT sale_id FROM payment_plans WHERE sale_id IS NOT NULL`
2. **Sales standalone** = `sales WHERE id NOT IN (planSaleIds) AND payment_status NOT IN ('refunded', 'cancelled')`
3. **Total contratado** = `sum(standalone.amount_cents) + sum(payment_plans.total_amount_cents)` (donde el plan no esté cancelado)
4. **Total cobrado** = `sum(standalone WHERE payment_status='paid')` + `sum(abonos.amount_cents WHERE plan_id IN planes del lead)`
5. **Saldo pendiente** = max(0, contratado - cobrado). Nunca negativo (aunque haya sobre-pagos por error humano).

Esta es la **misma fórmula** que usa `getSalesBreakdown` en `src/lib/queries/sales-kpi.ts:79-141` — `buildReportData` debe reutilizarla o ser bit-by-bit consistente con ella. Si el dashboard muestra $X cobrado y el Excel muestra $Y, hay un bug.

**Hoja 2 — "Transacciones"**

Una fila por cobro REAL en el periodo (sale standalone pagada O abono de plan pagado):

| Columna | Tipo |
|---------|------|
| Fecha cobro | date |
| Marca | string |
| Lead | string |
| Rep | string |
| Tipo | "Venta" / "Abono plan" |
| Producto | string (si aplicable) |
| Monto | currency USD |
| Método pago | string |
| Notas | string |

**Hoja 3 — "KPIs"**

Layout vertical, no tabular. Celdas con etiqueta + valor:

```
Periodo: 2026-05-01 → 2026-05-19
Marca:   Todas

Total cobrado en periodo:    $X
Total por cobrar (cartera):  $Y
Ventas nuevas en periodo:    N
Planes activos:              N
Promedio ticket:             $Z

POR MARCA:
  Si Se Pierde:  cobrado $X | pendiente $Y
  SunnySlim:     cobrado $X | pendiente $Y

POR REP (top 10 por monto cobrado):
  Moe:        cobrado $X | ventas N
  Honorina:   ...
```

### UI — Dialog

3 controles:
1. **Marca:** select `[Todas | Si Se Pierde | SunnySlim]`. Default = marca activa del switcher global (o "Todas" si no hay).
2. **Rango:** dos date inputs `desde` / `hasta`. Default = mes actual (1ro del mes → hoy).
3. **Checkbox:** "Todo el histórico". Al marcarlo, los date inputs se desactivan visualmente.

Botón "Generar Excel" → genera filename `reporte_<marca>_<from>_<to>.xlsx` (o `reporte_<marca>_historico.xlsx`) y dispara descarga.

### Tool del bot — `generate_sales_report`

```typescript
{
  name: "generate_sales_report",
  description: "Genera un reporte Excel de ventas con 3 hojas (resumen por paciente, transacciones detalladas, KPIs). Devuelve un link de descarga que expira en 24h. Usá esta tool cuando el usuario pida 'mandame un Excel', 'generá un reporte', 'cuánto cobramos en X periodo en formato Excel', etc.",
  input_schema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Fecha inicial YYYY-MM-DD. Omitir si historico=true." },
      to: { type: "string", description: "Fecha final YYYY-MM-DD. Omitir si historico=true." },
      brand: {
        type: "string",
        enum: ["all", "sisepierde", "sunnyslim"],
        description: "Marca. Default 'all' (incluye todas con columna Marca)."
      },
      rep_name: { type: "string", description: "Nombre del rep para filtrar (case-insensitive, partial match contra users.name). Omitir para todos los reps." },
      status: {
        type: "string",
        enum: ["all", "paid", "pending"],
        description: "Filtrar transacciones por status. Default 'all'."
      },
      historico: { type: "boolean", description: "Si true, ignora from/to y genera todo el histórico. Default false." }
    }
  }
}
```

El executor:
1. Resuelve `brandId` desde el slug (si no es 'all')
2. Resuelve `repId` desde `rep_name` con ilike contra `users.name` SOLO si el user actual es admin o manager. Si es rep, ignora el filtro `rep_name` y siempre filtra por sí mismo.
3. Si `rep_name` no matchea, devuelve **mismo mensaje genérico** que cuando un rep no-admin pide datos de otro rep: `"No encontré datos para los filtros indicados."` (NO sugerencia de nombres similares — evita info leak de quién existe).
4. Llama `buildReportData(...)` con privilegios del user actual (NO service role — respeta RLS).
5. Genera el xlsx con `xlsx`
6. Sube a Storage: `reports/{userId}/{ISO_timestamp}_{filename}.xlsx`
7. Genera signed URL (24h)
8. Devuelve `{ download_url, expires_at, filename, summary: "Generé el reporte de X con N pacientes y M transacciones." }`

El bot responde al user: *"Listo, generé el reporte. Descargalo acá: [link]. El link expira en 24 horas."*

## Decisiones de seguridad

1. **Sin service role para generar reportes.** El endpoint y la tool usan el cliente SSR del user → RLS filtra naturalmente (un rep solo ve sus leads/sales; admin ve todo).
2. **Bucket `reports/` privado.** Path-prefixed por userId. Política RLS de Storage: `bucket_id = 'reports' AND (storage.foldername(name))[1] = auth.uid()::text`.
3. **Signed URL 24h.** Largo para que el cliente lo abra cuando quiera, corto para que no quede expuesto eterno. Si se necesita más, se vuelve a generar.
4. **No SQL libre.** Este spec NO incluye query builder dinámico. Las queries son fijas, parametrizables solo por filtros tipados.
5. **No info-leak de reps via bot.** Si un rep no-admin pide reporte de otro rep, el bot devuelve el mismo mensaje genérico que cuando un nombre no existe. Nunca confirma ni niega la existencia de otros usuarios.

## Performance y timeouts

- **`export const maxDuration = 60`** en el route handler — necesitamos los 60s de Pro (verificar plan Vercel actual; si Hobby, máximo son 10s y hay que evaluar si es suficiente para histórico completo).
- **Límite de filas en query:** hard cap de 50,000 filas combinadas (sales + abonos). Si excede, error claro al user con sugerencia de filtrar por rango/marca.
- **Generación del xlsx en memoria:** library `xlsx` mantiene todo en memoria; para 50K filas + 3 hojas el footprint es ~30-40MB. Vercel function default es 1024MB, hay margen.
- **Streaming response:** una vez generado el buffer, se devuelve como stream al cliente para no demorar el TTFB.

## Errores y edge cases

- **No hay datos en el rango:** generar workbook con las 3 hojas vacías (solo headers + fila "Sin datos en el periodo seleccionado"). Devolver con 200, no error.
- **Bot pide rep que no existe (o que el user no puede ver):** la tool devuelve el mensaje genérico `"No encontré datos para los filtros indicados."`. NO sugiere nombres similares (evita info-leak de qué reps existen). Si el user es admin, log interno para debug, pero la respuesta al user es la misma.
- **Bot pide rango inválido (`to` < `from`):** error de la tool, mensaje al user.
- **Storage upload falla:** la tool devuelve error con causa; el bot lo dice y sugiere reintentar.
- **Reporte muy grande (>50K filas combinadas sales+abonos):** límite hard. Si excede, devolver mensaje "Reporte muy grande, achicá el rango o filtrá por marca."
- **Sales con `payment_status='refunded'` o `'cancelled'`:** excluidas de `Total contratado` Y de `Total cobrado` (no se cuentan en ningún lado). Sí aparecen en Hoja 2 (Transacciones) con su status visible, para no perder trazabilidad.
- **Planes cancelados:** mismo tratamiento — excluidos del `Total contratado` del paciente.
- **Lead sin nombre o sin teléfono:** filas con celdas vacías en esas columnas (no error).
- **Plan sin installments calculadas:** "Próxima cuota" queda vacía.

## Testing

- **Manual:** abrir el dialog, generar Excel con cada combinación de marca, validar que las 3 hojas tengan datos coherentes. Validar contra `getSalesBreakdown` (que ya existe en `src/lib/queries/sales-kpi.ts`).
- **Bot:** desde el panel del bot pedir variantes en lenguaje natural ("mandame el reporte de marzo", "Excel de SunnySlim de Moe", "todo lo pendiente"). Verificar que el link descarga el archivo correcto.
- **RLS:** loguearse como rep y verificar que el Excel solo trae datos de SUS leads/sales, no de otros reps.
- **Vacío:** generar reporte de un periodo sin datos → workbook con headers vacíos.

## Cambios de DB

**Ninguno.** No hay migrations. Solo lectura + un bucket nuevo en Storage (config, no migration).

**Setup manual en Supabase Storage (antes de mergear):**
1. Crear bucket `reports` (privado, no público)
2. Aplicar policy: solo el owner del path (`{userId}/...`) puede SELECT/INSERT su propio archivo

Cuando se implemente, mostrar al usuario el SQL/UI exacto antes de aplicarlo (regla del usuario: "mostrar SQL antes de aplicarlo a Supabase").

## Archivos a crear/modificar

**Crear:**
- `src/lib/exports/report-data.ts` — función `buildReportData()` (data layer compartido)
- `src/lib/exports/xlsx-builder.ts` — función `buildReportWorkbook(reportData)` que arma el .xlsx
- `src/app/api/exports/report/route.ts` — endpoint
- `src/components/exports/report-export-dialog.tsx` — dialog UI
- `src/components/exports/report-export-button.tsx` — botón que abre el dialog
- `src/lib/agent/file-tools.ts` — registro de file tools + executor de `generate_sales_report`

**Modificar:**
- `src/app/(app)/sales/page.tsx` — reemplazar `<ExportButton entity="sales" />` por `<ReportExportButton />`
- `src/app/api/agent/ask/route.ts` — registrar `FILE_TOOLS` junto a `AGENT_TOOLS` y `WRITE_TOOLS`; agregar dispatcher para ejecutarlas
- `src/lib/agent/prompts.ts` — agregar al system prompt la mención de que existe `generate_sales_report` y cuándo usarla
- `src/i18n/messages/es.json` + `en.json` — strings del dialog nuevo

## Estimación

**1.5-2 días** distribuidos así:
- 0.5 día: `report-data.ts` reusando `getSalesBreakdown` + lógica de `/leads/[id]/page.tsx:106-132`
- 0.5 día: `xlsx-builder.ts` con las 3 hojas + tests manuales
- 0.25 día: endpoint + dialog UI
- 0.5 día: tool del bot + storage setup + prompt update
- 0.25 día: i18n + smoke tests + deploy

## Aprobación

- [ ] Spec revisado por usuario
- [ ] Aprobado para pasar a `writing-plans`
