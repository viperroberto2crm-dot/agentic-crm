# Centro de Canales — 2026-08-25

Decidido con Roberto: **los dos, bandeja primero**. Canales que entran después:
Instagram DM, Facebook Messenger, Email.

Motivo real (hallazgo): hoy la tabla `messages` solo se lee en
`leads/[id]/page.tsx` filtrando por `lead_id`. **Los mensajes de quien todavía no
es lead se guardan y NADIE los ve.** Eso es el leak que la bandeja cierra.

Decisión de número (Roberto, 2026-08-25): el WhatsApp del CRM **no** es el
+1 562-298-3012 — ese se queda en la app, con la persona que contesta.

---

## FASE 1 — Bandeja unificada `/mensajes`

- [x] 1. SQL `docs/sql/2026-08-25-bandeja.sql`: `messages.read_at` + índices
      (`brand_id, created_at`) y (`from_number`). Aditivo.
- [x] 2. `src/lib/queries/messages.ts` — agrupar mensajes en conversaciones.
      Conversación = (marca, canal, lead_id ó número). Agrupado en TS sobre una
      consulta acotada (90 días / 2000 filas) — sin vista nueva, sin RLS nueva.
      Si el volumen crece, se cambia a un RPC; queda anotado, no silencioso.
- [x] 3. `/mensajes` — página server, con el mismo scoping por marca que el resto.
- [x] 4. `_components/inbox.tsx` — lista de conversaciones + hilo + responder,
      con Realtime. Reusa `sendSms` / `sendWhatsApp` (guards y opt-out intactos).
- [x] 5. Conversaciones SIN lead: botón **"Crear paciente"** (acción nueva) que
      convierte el número en lead de la marca y engancha el hilo existente.
      Responder exige lead — así el opt-out y la ventana de 24h siguen aplicando.
- [x] 6. Marcar leído + badge de no leídos en el sidebar.
- [x] 7. Bucket **"Sin marca"** solo-admin (mensajes con `brand_id` null, que la
      RLS deja invisibles). Bypass explícito y guardado, si no se pierden.
- [x] 8. i18n es/en + item en el sidebar.
- [x] 9. `tsc` + build + probar en producción.

## FASE 2 — Registro + adaptadores

- [ ] 10. `src/lib/channels/types.ts` — contrato `ChannelAdapter`
      (`verifyWebhook`, `parseInbound`, `send`, `capabilities`).
- [ ] 11. `registry.ts` + `adapters/twilio-sms.ts` + `adapters/whatsapp-cloud.ts`
      (mover la lógica que hoy vive suelta en las rutas).
- [ ] 12. `api/webhooks/[channel]/route.ts` — UNA ruta que despacha.
      **Las rutas viejas se quedan** delegando: `/api/webhooks/twilio` y
      `/api/webhooks/whatsapp` YA están registradas con Twilio y Meta; romper
      esas URLs tira los canales en vivo.
- [ ] 13. `sendSms`/`sendWhatsApp` pasan a una sola `sendMessage(channel, …)`.
- [ ] 14. `tsc` + build + volver a probar los dos canales vivos.

## Review
(pendiente)
