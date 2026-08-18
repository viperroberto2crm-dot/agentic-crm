# CRM — Pendientes / Próximos pasos

## ✅ HECHO (2026-07-08) — Columna de compañía en Calls / Appointments / Sales
Implementado igual que Leads: columna "Company" solo en modo "All companies",
acotado a marcas autorizadas (.in), cliente de sesión (RLS). commit + build OK.
Pendiente menor: los KPI cards de Sales (getSalesBreakdown) en all-mode usan
brandId=null y dependen de RLS — revisar si conviene acotarlos a authorizedBrandIds.

## (original) Columna de compañía en TODAS las secciones (no solo Leads)
**Fecha anotada:** 2026-07-08
**Pedido por:** Roberto

Igual que ya se hizo en **Leads** (columna "Company" con punto de color + nombre
de la marca en la vista "All companies"), replicar esa columna/label de
**compañía por fila** en las demás secciones que tienen lista:

- [ ] **Calls** (`/calls`) — hoy NO muestra la compañía por llamada
- [ ] **Appointments** (`/appointments`)
- [ ] **Sales** (`/sales`)
- [ ] Revisar también: **Payments due**, **Tasks**, **Shipping** (si aplica)

Requisitos (mismos que en Leads):
- Mostrar la columna/label de compañía **solo en modo "All companies"** (cuando
  hay una sola marca activa, no hace falta la columna — igual que en Leads).
- Reusar el patrón de Leads: punto de color de la marca (`brand_color` /
  fallback por slug) + nombre, íconos/colores HORIZON, sin emojis.
- Los datos de marca por fila probablemente ya vienen en el query (Leads ya
  hacía join con `brands`); verificar en cada sección y agregar el join si falta.
- Acotar a marcas autorizadas del usuario (mismo criterio de seguridad que Leads:
  `.in("brand_id", autorizadas)`), usando el cliente de sesión (RLS).

Referencia de cómo quedó en Leads (para copiar el patrón):
- `src/app/(app)/leads/page.tsx` (modo all + brandIds)
- `src/app/(app)/leads/_components/leads-table-bulk.tsx` (columna showCompany)
- `src/lib/queries/leads.ts` (join a brands + brandIds)

---

## Otros pendientes registrados
- [ ] **Forma de intake en clínica** (tablet/kiosco por QR por clínica + página
  interna para recepción). Esperando que Roberto suba su forma actual para copiar
  los campos exactos. Crea lead en la compañía correcta.
- [ ] **Fix causa raíz del botón "Sync tracking numbers"** (`backfill-actions.ts:156`):
  hoy asigna todo a `si-se-pierde` por default → blindar para que no vuelva a
  revolver los números.
- [ ] **ECID backfill** (`/admin/ecid-backfill`) para los ~135 leads "sin nombre"
  acumulados (opcional, de pago; celulares a menudo no resuelven).
- [ ] **Permisos de marcas nuevas** (Horizon, Horizon Wound Care): asignar
  managers/reps en Settings → Users si deben atender esos leads.

## Deploy pendiente
- Fix del webhook (auto-crear lead + ECID en llamadas entrantes) ya está en
  GitHub (`0cace4a`). Falta **deployar** (Vercel dashboard → Promote to
  Production, o `vercel --prod` + `vercel alias set`) para que aplique en vivo.
