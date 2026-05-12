# CHECKPOINTS — Criterios de "feature terminada correctamente"

Una feature solo pasa a `"status": "done"` si cumple TODOS estos checkpoints.

## CP-1: TypeScript limpio
```bash
npx tsc --noEmit
# Debe terminar sin errores
```

## CP-2: Build de producción
```bash
npx next build
# Debe terminar con ✓ Compiled successfully
```

## CP-3: Patrón Server Component correcto
- Páginas en `app/(app)/` son Server Components por defecto
- Solo marcar `"use client"` si el componente usa hooks o eventos del browser
- Server actions en archivos `actions.ts` con `"use server"` al inicio

## CP-4: Supabase tipado
- Toda query usa el cast: `supabase as unknown as SupabaseClient<Database>`
- Columnas de enums se castean explícitamente: `as Database["public"]["Enums"]["nombre_enum"]`
- No usar `any` en tipos de respuesta de Supabase

## CP-5: Autorización presente
- Toda server action verifica `supabase.auth.getUser()` antes de operar
- Acciones de admin/manager tienen check de rol explícito
- Reps solo ven/editan sus propios registros

## CP-6: Ruta accesible
- La nueva ruta aparece listada en `npx next build` como `ƒ /ruta-nueva`
- No lanza errores 404 ni 500 en dev con `npm run dev`

## CP-7: Informe del implementer
- Existe `progress/impl_<feature-id>.md` con archivos creados/modificados
- Existe `progress/review_<feature-id>.md` con checklist contra estos CPs

## Criterios de rechazo automático
- Cualquier `@ts-ignore` o `as any` sin justificación en comentario
- Server action sin verificación de usuario autenticado
- Componente client que podría ser server (hace fetch pero no usa hooks)
