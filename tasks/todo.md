# WhatsApp (Meta Cloud API) → CRM — 2026-08-25

Decisión: **Meta Cloud API directo** (reusa el número ya aprobado del WhatsApp Bot,
Phone Number ID 1110569578806809) + alcance **recibir + responder + plantillas**.

Se monta sobre los rieles que YA existen del SMS: tabla `messages` (columna
`channel`), `connection_credentials` (secretos cifrados), hilo realtime en la ficha.

## Plan

- [ ] 1. SQL aditivo `docs/sql/2026-08-25-whatsapp.sql`
      - `leads.wa_opt_out` / `wa_opt_out_at` (consentimiento propio de WhatsApp)
      - `brands.whatsapp_phone_number_id` (remitente por marca; null → global)
      - índice `messages(channel)`
- [ ] 2. `src/lib/integrations/whatsapp.ts` — cliente Graph API: enviar texto,
      enviar plantilla, listar plantillas, verificar firma X-Hub-Signature-256.
- [ ] 3. `connectors.ts` — conector `whatsapp` (phone_number_id, access_token,
      verify_token, app_secret, waba_id) → formulario "Conectar" en Configuración.
- [ ] 4. `health.ts` — quitar "Próximamente"; estado real + prueba en vivo.
- [ ] 5. `brand-numbers.ts` — resolver marca ← phone_number_id entrante, y
      remitente ← marca (patrón idéntico al de Twilio).
- [ ] 6. `src/app/api/webhooks/whatsapp/route.ts` — GET (verificación de Meta) +
      POST (firma, mensajes entrantes, statuses, STOP/START, idempotencia por wamid).
- [ ] 7. `sendWhatsApp` + `getWhatsAppTemplates` en `leads/[id]/actions.ts`
      — guards de rol/marca, opt-out, y **ventana de 24h** validada en el servidor:
      dentro → texto libre; fuera → obliga plantilla aprobada.
- [ ] 8. UI: el hilo de la ficha pasa a ser multicanal (pestañas SMS | WhatsApp),
      con selector de plantilla cuando la ventana está cerrada. i18n es/en.
- [ ] 9. `tsc` + lint, commit, push y deploy.

## Review
(pendiente)
