# Arquitectura — agentic-crm

## Stack

| Capa         | Tecnología                        |
|--------------|-----------------------------------|
| Framework    | Next.js 15 App Router             |
| Runtime      | React 19, TypeScript 5            |
| Base de datos| Supabase (PostgreSQL)             |
| Auth         | Supabase SSR (`@supabase/ssr`)    |
| UI           | shadcn/ui + Tailwind CSS          |
| Validación   | Zod                               |
| Import datos | xlsx (SheetJS)                    |

## Estructura de rutas

```
app/(app)/          ← rutas protegidas (requieren auth)
├── dashboard/      ← KPI cards, urgentes, citas próximas
├── leads/          ← lista, nuevo, detalle, import
│   ├── page.tsx    ← Server Component con filtros + paginación
│   ├── new/        ← form creación (Client Component)
│   ├── import/     ← flujo xlsx multi-step
│   └── [id]/       ← detalle + timeline + edit + delete + venta
├── sales/          ← KPI ventas + tabla con filtros
├── appointments/   ← [PENDIENTE]
├── calls/          ← [PENDIENTE]
├── tasks/          ← [PENDIENTE]
└── settings/       ← [PENDIENTE]
```

## Modelo de datos (tablas principales)

| Tabla           | Descripción                                  |
|-----------------|----------------------------------------------|
| `users`         | Perfiles con role: admin/manager/rep         |
| `brands`        | Marcas/negocios (multi-tenant)               |
| `leads`         | Prospectos con status, source, score, rep    |
| `calls`         | Registro de llamadas por lead                |
| `appointments`  | Citas con type, status, service              |
| `sales`         | Ventas con amount_cents, payment_status      |
| `sale_items`    | Items de cada venta (productos)              |
| `products`      | Catálogo de productos/servicios por marca    |
| `subscriptions` | Suscripciones recurrentes auto-creadas       |
| `tasks`         | Tareas asignables a reps con prioridad       |

## Enums críticos

```typescript
lead_status:        new | contacted | qualified | appointment_set | sold | lost | on_hold
lead_source:        inbound_call | web_form | referral | whatsapp | walk_in | social | other
call_direction:     inbound | outbound
call_outcome:       connected | voicemail | no_answer | wrong_number | callback_requested
appointment_type:   in_person | phone | video
appointment_status: scheduled | completed | cancelled | no_show
payment_method:     cash | card | stripe
payment_status:     pending | paid | failed | refunded | partial
task_priority:      low | medium | high | urgent
task_status:        pending | in_progress | done | cancelled
user_role:          admin | manager | rep
```

## Autenticación y roles

- Auth via Supabase SSR con cookies (no localStorage)
- Middleware en `src/middleware.ts` → `src/lib/supabase/middleware.ts`
- **Fix crítico**: server actions llevan header `Next-Action` → el middleware NO redirige a login en ese caso
- Roles: `admin` > `manager` > `rep`
- Reps solo ven/editan sus propios registros (`assigned_rep_id = user.id`)

## Multi-tenant (brands)

- La marca activa se guarda en cookie `crm_brand_slug`
- En Server Components: `cookies().get("crm_brand_slug")`
- En Client Components: `useBrand()` del contexto `src/context/brand-context.tsx`
- `getBrandIdBySlug(slug, sb)` en `src/lib/queries/dashboard.ts`

## Workaround de tipos Supabase

```typescript
// supabase-js@2.46.1 tiene 5 genéricos, el IDE espera 3
const sb = supabase as unknown as SupabaseClient<Database>
```

Usar en TODOS los server components y actions.
