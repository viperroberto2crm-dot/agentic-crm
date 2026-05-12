# Convenciones de código — agentic-crm

## Patrón base de Server Component (página)

```typescript
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type TypedClient = SupabaseClient<Database>

export default async function MiPagina({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient

  // fetch de perfil para obtener role
  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).single()
  const role = (profile?.role ?? "rep") as string

  // ... queries paralelas con Promise.all
}
```

## Patrón base de Server Action

```typescript
"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"

async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

const MiSchema = z.object({ /* ... */ })
export type MiInput = z.infer<typeof MiSchema>

export async function miAction(raw: MiInput) {
  const input = MiSchema.parse(raw)
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // check de rol si aplica
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  
  const { error } = await supabase.from("mi_tabla").insert(input)
  if (error) throw new Error(error.message)

  revalidatePath("/mi-ruta")
}
```

## Patrón Client Component con Server Action

```typescript
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

export function MiComponente() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit() {
    setError(null)
    startTransition(async () => {
      try {
        await miServerAction(data)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error inesperado")
      }
    })
  }
}
```

## Estilos y componentes UI

- Fondo oscuro: `bg-zinc-900`, `bg-zinc-950`, `bg-zinc-800`
- Bordes: `border-zinc-800`, `border-zinc-700`
- Texto primario: `text-zinc-100`, `text-zinc-200`
- Texto secundario: `text-zinc-500`, `text-zinc-600`
- Acento de marca: `style={{ background: "var(--brand)" }}`
- Botón primario: `<Button style={{ background: "var(--brand)" }}>`
- Botón secundario: `<Button variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">`
- Cards: `<Card className="bg-zinc-900 border-zinc-800/60">`

## Estructura de archivos por ruta

```
app/(app)/mi-ruta/
├── page.tsx              ← Server Component (datos + layout)
├── loading.tsx           ← Skeleton de carga
├── actions.ts            ← "use server" — todas las mutations
└── _components/
    ├── mi-tabla.tsx      ← "use client" si necesita interactividad
    └── mi-modal.tsx      ← Dialog/Sheet para crear/editar
```

## Queries con filtros por rol

```typescript
// En queries/mi-entidad.ts
let query = sb.from("mi_tabla").select("*")

if (role === "rep") {
  query = query.eq("assigned_rep_id", userId)
}
// managers y admins ven todo — no filtrar
```

## Paginación estándar

- `limit: 50` por defecto
- `offset` via `searchParams`
- Links de paginación con URLSearchParams preservando filtros activos

## Naming conventions

- Archivos: `kebab-case.tsx`
- Componentes: `PascalCase`
- Server actions: `camelCase` (ej: `createAppointment`, `updateTaskStatus`)
- Queries reutilizables: en `src/lib/queries/nombre-entidad.ts`
