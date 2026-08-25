# WhatsApp (Meta Cloud API) → CRM — 2026-08-25

Decisión: **Meta Cloud API directo** (reusa el número ya aprobado del WhatsApp Bot,
Phone Number ID 1110569578806809) + alcance **recibir + responder + plantillas**.

Se monta sobre los rieles que YA existen del SMS: tabla `messages` (columna
`channel`), `connection_credentials` (secretos cifrados), hilo realtime en la ficha.

## Plan

- [x] 1. SQL aditivo `docs/sql/2026-08-25-whatsapp.sql`
      - `leads.wa_opt_out` / `wa_opt_out_at` (consentimiento propio de WhatsApp)
      - `brands.whatsapp_phone_number_id` (remitente por marca; null → global)
      - índice `messages(channel)`
- [x] 2. `src/lib/integrations/whatsapp.ts` — cliente Graph API: enviar texto,
      enviar plantilla, listar plantillas, verificar firma X-Hub-Signature-256.
- [x] 3. `connectors.ts` — conector `whatsapp` (phone_number_id, access_token,
      verify_token, app_secret, waba_id) → formulario "Conectar" en Configuración.
- [x] 4. `health.ts` — quitar "Próximamente"; estado real + prueba en vivo.
- [x] 5. `brand-numbers.ts` — resolver marca ← phone_number_id entrante, y
      remitente ← marca (patrón idéntico al de Twilio).
- [x] 6. `src/app/api/webhooks/whatsapp/route.ts` — GET (verificación de Meta) +
      POST (firma, mensajes entrantes, statuses, STOP/START, idempotencia por wamid).
- [x] 7. `sendWhatsApp` + `getWhatsAppTemplates` en `leads/[id]/actions.ts`
      — guards de rol/marca, opt-out, y **ventana de 24h** validada en el servidor:
      dentro → texto libre; fuera → obliga plantilla aprobada.
- [x] 8. UI: el hilo de la ficha pasa a ser multicanal (pestañas SMS | WhatsApp),
      con selector de plantilla cuando la ventana está cerrada. i18n es/en.
- [x] 9. `tsc` + lint, commit, push y deploy.

## Review

**HECHO y desplegado** — commit `9fd5846` en `master`, vivo en agentic-crm-sigma.vercel.app.

### La decision de diseno que importa
El plan viejo (nota del vault) pedia una tabla `whatsapp_messages`. **No se hizo asi.**
WhatsApp entro como UN CANAL MAS de la tabla `messages` que ya usaba el SMS
(`provider='whatsapp'`, `channel='whatsapp'`, `external_id`=wamid). Motivo: esa tabla
ya traia RLS por marca, Realtime, e indice unico para idempotencia. Una tabla aparte
habria duplicado las tres cosas y partido la conversacion del paciente en dos pantallas.

### Verificacion
- `tsc --noEmit` exit 0. `npm run build` exit 0, con `/api/webhooks/whatsapp` registrada.
- Lint: 0 hallazgos en los archivos tocados (los errores que quedan son preexistentes
  en 800com.ts / reflection.ts / report-data.ts y no gatean el build, ver next.config.ts).
- En PRODUCCION, fail-closed comprobado: `GET` y `POST` sin credenciales devuelven
  `503 {"error":"not configured"}`; con verify_token falso NO entrega el hub.challenge.

### Falta (manual, no es codigo)
1. Correr `docs/sql/2026-08-25-whatsapp.sql` en Supabase — **sin esto no se puede enviar**.
2. Configuracion -> Integraciones -> WhatsApp -> Conectar (5 campos).
3. Registrar el webhook en Meta y suscribir el campo `messages`.
4. Decidir que numero se usa (el Phone Number ID 1110569578806809 es del bot de Railway,
   NO es el +1 562-298-3012).

