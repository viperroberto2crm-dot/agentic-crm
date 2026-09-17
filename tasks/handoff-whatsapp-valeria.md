# HANDOFF — Puente WhatsApp → Valeria (leer esto primero)

Escrito: 2026-09-17. Para la sesión de Claude Code que va a programar la Fase 1.
El plan con las casillas está en `tasks/todo.md`. Esto es el CÓMO y el POR QUÉ.

## Qué se va a construir

Anuncio Click-to-WhatsApp → bot de texto (3-4 mensajes: nombre, qué necesita,
permiso para llamar, horario) → lead en el CRM con el consentimiento guardado →
Retell llama con Valeria → Valeria agenda y manda el link de pago.

WhatsApp SOLO capta y consigue el permiso. La venta se cierra por teléfono: así se
evitan la ventana de 24h y el cobro por mensaje de Meta.

## Decisiones ya tomadas (no re-litigar)

1. **Número NUEVO para los anuncios**, no el +1 562-298-3012. Evita Coexistence,
   Tech Provider, BSP y semanas de trámite; y evita que el bot le conteste a un
   paciente viejo (ese número lo contesta una persona: es a donde transfiere Valeria).
2. **El bot NO cierra venta ni cobra por WhatsApp.** Eso lo hace Valeria en la llamada.
3. **Todo detrás de feature flags default OFF** + modo dry-run.
4. Sin el "sí, llámenme" explícito y guardado, NO se dispara ninguna llamada.

## Mapa del código (verificado, con rutas reales)

### Lo que YA funciona y NO hay que tocar

- `src/app/api/webhooks/whatsapp/route.ts` — solo la URL; delega al Centro de Canales.
  **La URL ya está registrada en Meta: cambiarla tira el canal.**
- `src/lib/channels/webhook.ts` — manejador único de entrantes: firma, match de lead
  por E.164, atribución de marca, consentimiento STOP/START, upsert idempotente por
  `(provider, external_id)`.
- `src/lib/channels/adapters/whatsapp-cloud.ts` — handshake, firma HMAC del cuerpo
  crudo, parse, ventana de 24h (`checkSendPolicy`), envío de texto y plantilla.
- `src/lib/integrations/whatsapp.ts` — cliente Graph API + `verifyMetaSignature`.
- `src/app/(app)/leads/[id]/actions.ts:1476` — `startBotCall`: llamada saliente con
  Retell (`POST https://api.retellai.com/v2/create-phone-call`), le pasa
  `retell_llm_dynamic_variables`: patient_name, lead_id, patient_phone, current_date
  (fecha de HOY en hora de California — sin eso el LLM agenda mal).
  **Valeria ya agenda y manda el link de pago con las herramientas de `/api/voice/*`.**

### Los 2 puntos de refactor (el corazón del trabajo)

Los dos tienen el mismo problema: **exigen sesión de usuario y el webhook no la tiene.**

1. `src/lib/channels/send.ts` → `sendChannelMessage` hace: `getCurrentRole` +
   `assertNotProvider` + `assertBrandMember` + opt-out del canal + `checkSendPolicy`
   (ventana 24h) + insert del saliente en `messages`.
   **Extraer los guards a una función compartida** y agregar una variante service-role
   para el bot. Los guards de paciente (opt-out, ventana, marca del lead) se conservan
   TODOS; lo único que no aplica a un bot es el guard de rol humano. El saliente del bot
   se registra en `messages` igual, para que aparezca en el hilo.

2. `startBotCall`: misma operación. Extraer el núcleo a `src/lib/voice/` y que lo llamen
   tanto el server action como el webhook. Mantener la validación de que el lead
   pertenece a la marca y que el teléfono sea E.164.

### Lo nuevo

- Capturar `referral` del webhook de Meta (`ctwa_clid`, `source_id`, headline) en
  `parse()` del adaptador → campo opcional nuevo en `InboundMessage` (`types.ts`) →
  guardar en `raw` y en el lead, para saber de qué anuncio vino.
- `src/lib/bot/…` — el agente de texto. Claude `claude-opus-5` con `@anthropic-ai/sdk`
  (ya está, ^0.96.0). Patrón de llamada a copiar: `src/lib/agent/reflection.ts:92`.
  OJO: el resto del repo usa `claude-sonnet-4-6`; para este bot se acordó `claude-opus-5`.
  Herramientas: `guardar_datos_del_lead` y `pedir_llamada`.
- Consentimiento: guardar el texto exacto del sí + timestamp + el mensaje que lo pidió.
- `callback_at` + cron para las llamadas diferidas. Patrón de cron con `CRON_SECRET`:
  `src/app/api/cron/auto-link-calls/route.ts`. Los crons se declaran en `vercel.json`.
- SQL aditivo nuevo en `docs/sql/`, siguiendo el estilo de `docs/sql/2026-08-25-whatsapp.sql`
  (`add column if not exists`, idempotente, con query de verificación al final).

### Tiempo de respuesta del webhook

Meta reintenta si el webhook tarda, así que la llamada a Claude NO puede bloquear el ACK.
Resolver con trabajo en segundo plano o ACK inmediato + proceso aparte; el upsert
idempotente por `wamid` ya protege contra el reintento.

## Convenciones del repo

- `tsc --noEmit` antes de cada commit. Preferir cambios ADITIVOS.
- Server Actions validadas con zod. Service role solo vía `createAdminClient()`.
- Textos de UI en `messages/es.json` + `messages/en.json`, nunca hardcodeados.
- Guard multi-marca: `role === "admin"` **+** fila en `user_brands`.
- Deploy: `vercel --prod` NO auto-promueve; hay que `vercel alias set` después.
- 503 "sin credencial" ≠ 403 "firma mala". No mezclarlos.

## Pendientes de Roberto (fuera del código)

- Conseguir el número nuevo y darlo de alta en Meta (Phone Number ID, token de System
  User, método de pago en el WABA).
- Correr `docs/sql/2026-08-25-whatsapp.sql` en Supabase — **pendiente desde agosto; sin
  esto no se puede enviar WhatsApp** (`sendWhatsApp` lee `wa_opt_out`).
- Confirmar `RETELL_API_KEY`, `RETELL_AGENT_ID`, `RETELL_FROM_NUMBER` en Vercel.
- [CONFIRMAR con Horizon] TCPA: la llamada automatizada a un celular necesita
  consentimiento previo — por eso se guarda el "sí" con fecha y hora.
- [CONFIRMAR] California: que Valeria avise que es un asistente automatizado.
- [CONFIRMAR] Qué puede prometer Valeria sobre precio y proceso del GLP-1.
