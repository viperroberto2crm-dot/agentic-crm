# Verificación — cómo demostrar que algo funciona

## Comandos de verificación (en orden)

```bash
# 1. TypeScript — sin errores de tipos
npx tsc --noEmit

# 2. Build de producción — sin errores de compilación
npx next build

# 3. Dev server — sin errores en consola al navegar la ruta
npm run dev
# Abrir http://localhost:3000/mi-ruta-nueva
```

## Qué confirmar en cada nueva ruta

### Server Component (página)
- [ ] Carga sin error 500
- [ ] Datos reales aparecen (no hardcodeados)
- [ ] Filtros actualizan URL y resultados
- [ ] Paginación funciona si aplica

### Modal / Form
- [ ] Campos pre-llenados cuando es edición
- [ ] Validación muestra errores sin recargar página
- [ ] Submit exitoso cierra modal y actualiza lista
- [ ] Estado de carga (`isPending`) deshabilita botón

### Server Action
- [ ] Acción sin sesión → arroja "Unauthorized"
- [ ] Acción de rep en dato ajeno → denegada
- [ ] Acción con datos inválidos → error de Zod con mensaje legible
- [ ] Acción exitosa → `revalidatePath` limpia cache

## Señales de que algo está mal

| Síntoma                                    | Causa probable                                      |
|--------------------------------------------|-----------------------------------------------------|
| "An unexpected response from the server"   | Server action redirigida por middleware              |
| Tipos `any` en respuesta de Supabase       | Falta cast `as Database["public"]["Tables"][...]["Row"]` |
| `Cannot find module '@/components/ui/...'` | Componente shadcn no instalado — `npx shadcn@latest add nombre` |
| Build falla con `ENOENT`                   | Paquete npm faltante — `npm install nombre`         |
| Página carga pero datos vacíos             | RLS bloqueando — revisar que `assigned_rep_id` esté correcto |
| `redirect()` dentro de try/catch           | Next.js redirect lanza excepción — mover fuera del try |

## Nota sobre `redirect()` en server actions

```typescript
// MAL — redirect() lanza una excepción especial, catch la intercepta
try {
  await supabase.from("leads").delete().eq("id", id)
  redirect("/leads")  // ← NUNCA dentro de try
} catch (e) { ... }

// BIEN
const { error } = await supabase.from("leads").delete().eq("id", id)
if (error) throw new Error(error.message)
revalidatePath("/leads")
redirect("/leads")  // ← fuera del try
```
