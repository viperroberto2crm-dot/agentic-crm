# Puente WhatsApp → Valeria: el bot capta, Valeria llama y cierra

Fecha: 2026-09-17 · Repo: proyectosagentic-crm · rama master

## La idea
WhatsApp cobra por mensaje y encierra la conversación en 24h. La llamada no tiene
esos límites y cierra mejor. Entonces WhatsApp solo hace UNA cosa: captar el lead y
conseguir el **permiso por escrito** para llamar. De ahí, Valeria llama y cierra.

    Anuncio CTWA → bot de WhatsApp (3-4 mensajes: nombre, qué necesita, permiso,
    horario) → lead en el CRM con el consentimiento guardado → Retell llama con
    Valeria → Valeria agenda y manda el link de pago → todo queda en la ficha.

## Lo que YA existe (esto es lo que hace el puente barato)
- `startBotCall` en `leads/[id]/actions.ts:1476` → Retell `create-phone-call` con
  `retell_llm_dynamic_variables` (nombre, lead_id, teléfono, fecha de hoy en hora de California).
- Valeria ya agenda y manda el link de pago con las herramientas de `/api/voice/*`.
- El webhook de WhatsApp ya recibe, verifica firma, atribuye marca y guarda en `messages`.
- El resumen de la llamada ya regresa a la ficha del paciente.

## DECISIÓN: número nuevo para los anuncios
Evita Coexistence, Tech Provider, BSP y semanas de trámite. El +1 562-298-3012 se
queda como está, con su persona. Cero riesgo de que el bot le conteste a un paciente viejo.

## FASE 0 — Manual de Roberto
- [ ] Número nuevo dado de alta en Meta (Phone Number ID + token de System User + método de pago).
- [ ] Correr `docs/sql/2026-08-25-whatsapp.sql` en Supabase (pendiente desde agosto).
- [ ] Configuración → Integraciones → WhatsApp (5 campos) + webhook + suscribir `messages`.
- [ ] Confirmar `RETELL_API_KEY`, `RETELL_AGENT_ID`, `RETELL_FROM_NUMBER` en Vercel.
- [ ] Apuntar el anuncio Click-to-WhatsApp al número nuevo.

## FASE 1 — Código (APROBADO 2026-09-17, tras auditoría de Fable)

Decisiones: **Sonnet** para el bot (el costo real del bot es Claude, no WhatsApp) ·
botón humano de llamar **sin cambios, pero con bitácora** · `callback_at` + cron
**fuera** de Fase 1.

### Correcciones de premisa que salieron de la auditoría (verificadas)
- Meta cobra por mensaje desde 2025-07-01, PERO los no-plantilla dentro de la
  ventana abierta son **gratis** (`free_customer_service`), y CTWA abre ventana
  gratuita de **72h**. El bot no cuesta WhatsApp; cuesta Claude.
- `checkSendPolicy` mide la ventana con `lastInboundAt(leadId)`, pero el entrante
  de un no-lead se guarda con `lead_id = null` → al crear el lead hay que
  REENGANCHAR el mensaje o la ventana lee "cerrada" y el bot no puede contestar.
- `storeInbound` prefiere la marca del lead sobre la del número receptor
  (webhook.ts:68-74) → el bot debe usar SIEMPRE la marca del `phone_number_id`.
- Un solo webhook sirve a TODOS los números de la app de Meta → el interruptor
  del bot va por marca en la BASE, no en un env var.
- Bug latente: `startBotCall` manda `metadata.brand_id`, pero el webhook de Retell
  lee `metadata.brand` como slug y cae al default "si-se-pierde".

### Pasos
- [ ] 1. **SQL aditivo** (no despliega nada, desbloquea el resto): bitácora de
      consentimiento append-only, estado de conversación + candado, 
      `brands.whatsapp_bot_enabled`, `messages.bot_state`, `leads.ad_ref`.
      Incluye correr el SQL pendiente de agosto (`2026-08-25-whatsapp.sql`).
- [ ] 2. **Refactor `send.ts`**: núcleo compartido con los guards de paciente,
      **recibiendo el cliente de Supabase como parámetro** (la entrada humana pasa
      el de sesión y conserva la RLS de `leads`; la de sistema pasa admin).
      Variante de sistema solo para WhatsApp y con `template` prohibido.
- [ ] 3. **Refactor de la llamada** dentro de `src/lib/voice/core.ts` (ya tiene
      `pacificToday()`; no duplicarlo). DOS entradas explícitas, sin booleano
      `requireConsent`. Arregla de paso `metadata.brand` (slug) para Retell.
      La humana registra quién disparó y que no había consentimiento.
- [ ] 4. **El bot** (Sonnet): candado por conversación + debounce (5 mensajes
      seguidos = 1 sola respuesta), tope de turnos, gate `+1` y horario 8am-9pm
      Pacific, aviso de asistente automatizado, nada de dosis/diagnóstico/promesas.
- [ ] 5. **Consentimiento + disparo**: texto FIJO en código (no lo escribe Claude)
      con la divulgación de TCPA; la bitácora guarda el wamid de la pregunta Y el
      de la respuesta. Segundo claim atómico antes de llamar a Retell (no tiene
      idempotency key). `after()` + `maxDuration = 60` en la ruta del webhook.
- [ ] 6. **Verificación**: tsc, build, fail-closed en producción (503 vs 403),
      prueba end-to-end, y comprobar que sin el "sí" NO se dispara nada.

### Recortado de Fase 1 (con motivo)
- `callback_at` + cron: los crons frecuentes NO corren en Vercel (Hobby = diarios);
  los dispara **cron-job.org**, externo y sin versionar. En Fase 1 el bot guarda la
  preferencia de horario y un humano marca.
- `referral` normalizado: se guarda crudo en `raw` (ya cae ahí) + `leads.ad_ref`.

### [CONFIRMAR] antes de prender el bot
- El texto exacto de la pregunta de consentimiento (lo redacto, lo aprueba Horizon).
  Un "¿te podemos llamar?" NO es consentimiento previo por escrito.
- El número de WhatsApp puede NO ser el celular donde quieren la llamada → el bot
  debe confirmar "¿a este mismo número?".

## FASE 2 — Verificación
- [ ] `tsc --noEmit` y `npm run build` en 0.
- [ ] Webhook sigue fail-closed (503 sin credenciales, 403 con firma mala).
- [ ] Prueba end-to-end con tu propio celular: escribir por el anuncio → recibir la llamada.
- [ ] Verificar que sin el "sí" explícito NO se dispara ninguna llamada.

## Legal — hay que resolverlo, no es opcional
- [ ] [CONFIRMAR con Horizon] Llamada automatizada a celular en EE.UU. (TCPA): necesita
      consentimiento previo. Por eso el "sí, llámenme" del chat se guarda con fecha y hora.
- [ ] [CONFIRMAR] California pide avisar que se habla con un asistente automatizado:
      revisar que Valeria lo diga al inicio.
- [ ] [CONFIRMAR] Qué puede prometer Valeria del GLP-1 (precio, proceso, nada de resultados).

## Review
(pendiente — se llena al terminar)
