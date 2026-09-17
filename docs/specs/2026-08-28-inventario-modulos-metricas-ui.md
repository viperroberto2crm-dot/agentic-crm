# Instrucciones para Claude Code — Módulos, Inventario, Métricas y UI

> **Qué es esto.** Cuatro fases, en orden, para que el CRM: (1) se prenda por módulos y no
> le dé todo a todos, (2) maneje productos e inventario, (3) tenga matemáticas y métricas
> exactas, (4) se vea y se use mejor.
> **Cómo se usa.** Cada fase es un PR. Al empezar una fase, pega en Claude Code el bloque
> `PROMPT` de esa fase, tal cual, sin resumirlo.
> Escrito el 2026-08-28 contra el código real de `viperroberto2crm-dot/agentic-crm`.

---

## Reglas invariables

Aplican a las cuatro fases. Si una instrucción de abajo choca con estas reglas, ganan estas.

1. **Nada de lo que ya funciona se rompe.** Todo cambio es aditivo. Si hay que tocar algo
   vivo (webhooks de pago, 800.com, RLS), se avisa **antes** y se espera confirmación.
2. **`npm run typecheck` pasa antes de cada commit.** Sin excepciones.
3. **SQL nuevo** va a `docs/sql/AAAA-MM-DD-nombre.sql`: aditivo, con `create table if not
   exists`, con RLS habilitada, con sus policies, y con un `select` de verificación al final.
   Claude **no corre SQL**: lo deja listo y dice exactamente qué pegar en Supabase → SQL Editor.
4. **El dinero es entero de centavos.** `amount_cents`, `cost_cents`, `unit_cost_cents`.
   Nunca `float`, nunca `numeric` para dinero, nunca dividir antes de sumar.
5. **Toda tabla nueva lleva `brand_id`** y RLS por membresía (`user_brands`), igual que las
   tablas existentes. Sin `brand_id` no se crea la tabla.
6. **Todo módulo nuevo nace apagado** y se prende por marca. Nada se activa para todos.
7. **Textos en `messages/es.json` y `messages/en.json`** (next-intl). Nada de texto duro en JSX.
8. **Push y deploy siempre**, y después `vercel alias set` — en este proyecto el deploy no
   promueve solo el alias de producción.
9. **Se escribe en español**, en el mismo estilo de comentarios del repo: explicar el *porqué*
   y las trampas, no describir lo obvio.

---

## FASE 1 — Módulos por marca

**Problema que resuelve.** Hoy qué integración aplica a cada clínica se decide con listas CSV
en variables de entorno (`SQUARE_BRAND_SLUGS`, `STRIPE_BRAND_SLUGS`,
`PRACTICE_BETTER_BRAND_SLUGS`) y con banderas globales. Prender un cliente exige redeploy y no
queda registro. Además, todos ven todas las pantallas aunque su clínica no use esa función.

**Qué se construye**

- Tabla `brand_modules`: `id`, `brand_id`, `module_key`, `enabled bool default false`,
  `config jsonb default '{}'`, `updated_by`, `updated_at`. Único sobre `(brand_id, module_key)`.
- `src/lib/modules/registry.ts` — catálogo, fuente única de la lista:
  `inventory`, `payments_stripe`, `payments_square`, `ehr_practicebetter`, `channels_sms`,
  `channels_whatsapp`, `voice_retell`, `call_tracking_800com`, `leadads_meta`.
  Cada entrada: `key`, nombre en español, una línea de qué hace, y `requires[]` (dependencias).
- `src/lib/modules/access.ts` — `isModuleEnabled(brandId, key)` y `getEnabledModules(brandId)`,
  con caché por request. **Compatibilidad:** si la marca no tiene fila en `brand_modules`, cae
  al CSV de entorno de hoy. Así el sistema arranca comportándose exactamente igual que ahora.
- Configuración → **Módulos**: switches por marca, solo admin. Al apagar un módulo con
  dependientes, avisar cuáles se apagan con él.
- Aplicar el candado en **dos** lugares: se oculta el link en el sidebar **y** se bloquea en
  el servidor (layout o página → `notFound()`). Esconder el link no es seguridad.

**Terminado cuando**

- Prender Square para una marca desde la pantalla surte efecto sin redeploy.
- Con todos los módulos en su estado actual, ninguna pantalla cambia de comportamiento.
- `npm run typecheck` limpio.

```
PROMPT FASE 1
Lee docs/specs/2026-08-28-inventario-modulos-metricas-ui.md y aplica las Reglas invariables.
Implementa solo la FASE 1 (Módulos por marca).
Antes de escribir código: dime qué archivos vas a crear y cuáles vas a tocar, y espera mi OK.
Deja el SQL en docs/sql/ sin correrlo y dime qué pegar en Supabase.
Lo crítico: la caída a las variables de entorno cuando la marca no tiene fila, para que nada
de lo que hoy está vivo cambie de comportamiento.
```

---

## FASE 2 — Productos e Inventario (módulo `inventory`)

**Regla de oro: el stock no se edita, se deriva.** Nadie escribe "quedan 12". Se registran
movimientos y las existencias son la suma. Un inventario editable a mano miente en cuanto dos
personas lo tocan el mismo día.

**Tablas** (`docs/sql/2026-XX-XX-inventario.sql`)

| Tabla | Para qué |
|---|---|
| `inventory_items` | `brand_id`, `product_id` (nullable — no todo insumo se vende), `sku`, `name`, `unit` (pieza, ml, caja), `cost_cents`, `reorder_point`, `active` |
| `inventory_locations` | `brand_id`, `clinic_id`, `name` — una clínica puede tener bodega y consultorio |
| `inventory_movements` | Libro append-only: `item_id`, `location_id`, `qty_delta` (positivo o negativo), `reason`, `ref_type`/`ref_id`, `unit_cost_cents`, `created_by`, `occurred_at` |
| `inventory_counts` | Conteo físico: se guarda lo contado y el sistema genera el movimiento de ajuste por la diferencia |

`reason` es enum: `purchase`, `sale`, `adjustment`, `transfer_in`, `transfer_out`, `waste`,
`return`.

**Reglas duras**

- **Nunca se borra ni se edita un movimiento.** Un error se corrige con un movimiento contrario
  que apunta al original. El kardex tiene que poder auditarse.
- **Idempotencia:** índice único parcial sobre `(ref_type, ref_id)` cuando `ref_id` no es nulo.
  Si el webhook de un pago se repite, el descuento de stock no se duplica. Misma disciplina que
  ya usa `leads (external_provider, external_id)`.
- **Salida por venta:** cuando una `sale_items` incluye un producto ligado a un
  `inventory_item`, se genera el movimiento `sale` con `qty_delta` negativo, `ref_type='sale_item'`.
  Si el módulo `inventory` está apagado para esa marca, no se genera nada y la venta sigue igual.
- **Costeo: promedio móvil ponderado**, en centavos enteros. Cada compra guarda su
  `unit_cost_cents`; el costo de una salida es el promedio vigente en ese momento, congelado en
  el movimiento. No se recalcula el pasado cuando cambia un costo.
- **Stock nunca negativo en la UI sin avisar.** Si un movimiento deja negativo, se permite pero
  se marca en rojo: significa que falta registrar una compra.

**Pantallas**

- `/inventario` — existencias por artículo y ubicación, valor total, y arriba lo único urgente:
  qué está bajo el punto de reorden.
- `/inventario/[id]` — el kardex: cada movimiento, quién y cuándo, con saldo corriente.
- Acciones: recibir compra, ajuste, transferencia entre ubicaciones, merma, conteo físico.
- Bajo el punto de reorden → notificación y tarea automática al manager de la marca.

**Terminado cuando**

- Registrar una compra de 10 y una venta de 3 deja existencia 7 en las dos pantallas y en el export.
- Reenviar dos veces el mismo webhook de pago descuenta una sola vez.
- Con el módulo apagado, `/inventario` no existe para esa marca y las ventas no generan movimientos.

```
PROMPT FASE 2
Lee docs/specs/2026-08-28-inventario-modulos-metricas-ui.md y aplica las Reglas invariables.
Implementa la FASE 2 (Productos e Inventario) como módulo opt-in con el sistema de la FASE 1.
Antes de escribir código: propón el esquema exacto y las policies RLS, y espera mi OK.
Lo crítico: el stock se deriva de movimientos (nunca se edita), la idempotencia por
(ref_type, ref_id), y que con el módulo apagado el sistema se comporte exactamente como hoy.
```

---

## FASE 3 — Matemáticas y métricas exactas

**Problema que resuelve.** Cada pantalla puede calcular a su manera y dar números distintos
para el mismo rango. Ya hay un helper correcto para ventas (`src/lib/queries/sales-kpi.ts`,
que cuenta los planes por sus abonos para no doble-contar); falta que **todo** pase por ahí y
que cada métrica tenga una sola definición escrita.

**Qué se construye**

- `src/lib/metrics/definitions.ts` — el diccionario. Cada métrica: `id`, nombre en español,
  **fórmula en una línea**, unidad (`money` | `count` | `percent` | `days`), de qué tablas sale,
  y si acepta rango de fechas. Este archivo es la verdad; la UI y el bot leen de aquí.
- `src/lib/metrics/compute.ts` — un cálculo por métrica, funciones puras sobre datos ya traídos.
  Prohibido calcular métricas dentro de componentes.

**Reglas de cálculo**

1. Todo en centavos enteros. Se divide **una sola vez**, al presentar.
2. **Denominador cero devuelve `null`, no `0`.** En pantalla se muestra `—`. Un 0% falso es peor
   que un dato faltante.
3. Redondeo solo al presentar: dinero a 2 decimales, porcentajes a 1 decimal.
4. Los rangos son `[inicio, fin)` — inicio incluido, fin excluido. Se resuelven en hora del
   Pacífico y se guardan y consultan en UTC, como ya lo hace el bot.
5. **"Cobrado" y "vendido" nunca se mezclan.** Cobrado es dinero que entró (abonos + ventas de
   contado). Vendido es lo comprometido. Una tarjeta jamás rotula uno con el nombre del otro.
6. Un reembolso o una cancelación es un movimiento negativo con su propia fecha, no una edición
   del original.

**Métricas del embudo** (definir las que falten)

`leads_nuevos` · `tasa_de_contacto` = leads con al menos una llamada o mensaje ÷ leads nuevos ·
`tasa_de_cita` · `show_rate` = citas atendidas ÷ citas agendadas · `tasa_de_cierre` = ventas ÷
citas atendidas · `ticket_promedio` = cobrado ÷ ventas pagadas · `cobrado` · `por_cobrar` ·
`vencido` (abonos con vencimiento pasado sin pagar) · `costo_por_lead` por número de rastreo ·
`ingreso_por_marca`, `por_producto`, `por_rep`.

**Métricas que abre el inventario**

`costo_de_lo_vendido` (COGS) · `margen_bruto` = cobrado − COGS · `margen_pct` ·
`unidades_vendidas` · `valor_de_inventario` = Σ existencia × costo promedio ·
`rotacion` = COGS del periodo ÷ valor promedio de inventario · `dias_de_inventario` = 365 ÷ rotación.

**Verificación** — sin esto la fase no está terminada

Agregar `vitest` como devDependency **solo** para funciones puras de `src/lib/metrics/` y
`sales-kpi.ts`, más el script `npm run test`. Casos obligatorios:

- Plan de pagos con abonos repartidos en dos meses: cada mes cuenta lo suyo, el total no se
  duplica cuando el plan se completa.
- Venta de contado sin plan.
- Reembolso parcial.
- Denominador cero → `null`.
- Un mes con cambio de horario (DST) en el Pacífico.

**Terminado cuando** el mismo rango da el mismo número en `/dashboard`, en `/sales`, en el
export CSV y en la respuesta del bot. Si difieren, la fase no está terminada.

```
PROMPT FASE 3
Lee docs/specs/2026-08-28-inventario-modulos-metricas-ui.md y aplica las Reglas invariables.
Implementa la FASE 3 (Matemáticas y métricas exactas).
Primero: audita src/lib/queries/ y las pantallas, y dame la lista de todos los lugares donde
hoy se calcula dinero o porcentajes fuera de sales-kpi.ts. Espera mi OK antes de tocar nada.
Después: crea el diccionario de métricas, migra esas pantallas a él, y escribe las pruebas.
Lo crítico: denominador cero devuelve null (se muestra "—"), centavos enteros, y que dashboard,
/sales, el export y el bot den el mismo número para el mismo rango.
```

---

## FASE 4 — Display y UI

**Meta.** Que se entienda de un vistazo y se use desde el teléfono. No es un rediseño: es
subir la claridad usando el sistema de componentes que ya existe (`src/components/ui`).
No se cambia la paleta ni la tipografía sin que yo lo pida.

**Reglas**

1. **Ningún número solo.** Cada cifra lleva tres cosas: el valor, qué significa en una línea, y
   contra qué se compara (periodo anterior o meta). Si no hay comparación, se dice.
2. Un solo componente `<Kpi>` para todas las tarjetas: valor, delta con signo y color, mini
   gráfica de tendencia, y **tooltip con la fórmula exacta** tomada del diccionario de la FASE 3.
   Que cualquiera pueda ver de dónde salió el número sin preguntar.
3. **El estado se ve, no se lee.** Pendiente, vencido, cobrado, bajo mínimo: cada uno con su
   pastilla de color y su forma. El color solo nunca es suficiente — siempre lleva texto.
4. Números alineados con `tabular-nums`, dinero con formato es-MX, unidades a la derecha.
5. **Los vacíos instruyen.** Nada de "Sin datos": "Aún no hay pagos en este rango. Registra el
   primero" con el botón al lado.
6. **Una sola tabla-patrón** para todas las listas: mismos filtros arriba, misma densidad,
   misma paginación, mismo export. Hoy cada lista se siente distinta.
7. **El teléfono es el caso principal.** Abajo de 768px las tablas se vuelven tarjetas; las
   acciones más usadas quedan al alcance del pulgar.
8. **Se nombra como el negocio, no como la base de datos.** Paciente, Cobrado, Por cobrar,
   Existencias, Bajo mínimo. Nunca `payment_status`, `qty_delta` ni `brand_id` en pantalla.
9. Lo urgente arriba: cada pantalla abre con lo que hay que atender hoy, y el detalle abajo.

**Terminado cuando** alguien que nunca usó el CRM abre `/dashboard` y puede decir en voz alta
qué significa cada tarjeta sin que le expliquen.

```
PROMPT FASE 4
Lee docs/specs/2026-08-28-inventario-modulos-metricas-ui.md y aplica las Reglas invariables.
Implementa la FASE 4 (Display y UI).
Empieza por /dashboard: propón el componente <Kpi> y el patrón de tabla, muéstrame el antes y
el después de UNA pantalla, y espera mi OK antes de aplicarlo al resto.
No cambies la paleta ni la tipografía. Reusa src/components/ui.
Lo crítico: ningún número sin comparación, el tooltip con la fórmula, y que en el teléfono las
tablas se vuelvan tarjetas.
```

---

## Orden y por qué

**1 → 2 → 3 → 4.** Los módulos van primero porque el inventario nace apagado y necesita el
interruptor. El inventario va antes que las métricas porque agrega COGS y margen, que son
justo las métricas que faltan. La UI va al final porque no vale la pena pulir la presentación
de un número que todavía puede estar mal.

## Lo que no se hace en estas fases

- No se toca HIPAA (decisión pendiente de la compañía).
- No se cablea Practice Better a marcas nuevas: está pausado, la conexión OAuth se deja intacta.
- No se convierte el CRM en SaaS multi-cuenta. Eso es su propio proyecto — ver el mapa del
  sistema para los dos cambios que lo destraban (llaves por marca y llaves de landing por cliente).
