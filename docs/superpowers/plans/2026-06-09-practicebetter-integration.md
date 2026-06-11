# Practice Better Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the CRM bidirectionally with Practice Better so sales reps see client sync status, appointments, and payments directly inside the lead profile — without opening Practice Better.

**Architecture:** 100% additive changes — two new DB tables, two new nullable columns on `leads`, one new webhook endpoint at `/api/webhooks/practicebetter`, one new API client module, and one new UI card on the lead profile. No existing logic is modified. Sync triggers when a sale's `payment_status` changes to `'paid'`. Webhooks from PB are verified via HMAC-SHA256 (same pattern as 800.com).

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase service role client, shadcn/ui Card/Badge, Practice Better REST API + HMAC-SHA256 webhooks.

> ⚠️ **Execution note:** Task 1 and 2 can be done immediately. Tasks 3–8 require the Practice Better API key and webhook secret — execute after PB approves API access and you have the actual endpoint documentation to verify field names.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| Supabase dashboard | SQL run | Add `pb_client_id`, `pb_synced_at` to `leads`; create `pb_appointments`, `pb_payments` tables |
| `.env.example` | Modify (append) | Document 3 new env vars |
| `src/lib/integrations/practice-better.ts` | Create | PB API client: `createPbClient()`, `getPbClient()` |
| `src/app/(app)/leads/[id]/actions.ts` | Modify (append) | Add `syncLeadToPracticeBetter()` server action |
| `src/app/(app)/leads/[id]/_components/sale-actions.tsx` | Modify (1 call) | Call `syncLeadToPracticeBetter()` when `payment_status` → `'paid'` |
| `src/app/api/webhooks/practicebetter/route.ts` | Create | Webhook handler: HMAC verify, route events to DB |
| `src/components/leads/PracticeBetterCard.tsx` | Create | Server component card: sync status, appointments, payments |
| `src/app/(app)/leads/[id]/page.tsx` | Modify (1 line) | Import and render `<PracticeBetterCard leadId={...} />` |

---

## Task 1: SQL Schema in Supabase

**Files:** Supabase dashboard → SQL Editor

- [ ] **Step 1: Run the following SQL in the Supabase dashboard**

```sql
-- Add Practice Better fields to leads (nullable — won't affect existing rows)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS pb_client_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS pb_synced_at TIMESTAMPTZ;

-- Appointments received from Practice Better
CREATE TABLE IF NOT EXISTS pb_appointments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  pb_appointment_id TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_at      TIMESTAMPTZ NOT NULL,
  completed_at      TIMESTAMPTZ,
  appointment_type  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pb_appointments_lead_id_idx ON pb_appointments(lead_id);

ALTER TABLE pb_appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read pb_appointments"
  ON pb_appointments FOR SELECT TO authenticated USING (true);

CREATE POLICY "service role all pb_appointments"
  ON pb_appointments FOR ALL TO service_role USING (true);

-- Payments received from Practice Better
CREATE TABLE IF NOT EXISTS pb_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  pb_payment_id TEXT NOT NULL UNIQUE,
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'paid',
  paid_at       TIMESTAMPTZ,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pb_payments_lead_id_idx ON pb_payments(lead_id);

ALTER TABLE pb_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read pb_payments"
  ON pb_payments FOR SELECT TO authenticated USING (true);

CREATE POLICY "service role all pb_payments"
  ON pb_payments FOR ALL TO service_role USING (true);
```

- [ ] **Step 2: Verify tables exist**

In Supabase Table Editor, confirm `pb_appointments` and `pb_payments` appear in the table list. Confirm `leads` now has columns `pb_client_id` and `pb_synced_at`.

- [ ] **Step 3: Commit a note**

```bash
git add -A
git commit -m "docs: Practice Better schema SQL (run in Supabase dashboard)"
```

---

## Task 2: Environment Variables

**Files:**
- Modify: `.env.example`
- Modify: `.env.local` (actual values — not committed)

- [ ] **Step 1: Append to `.env.example`**

Open `.env.example` and add at the end:

```bash
# Practice Better
PB_API_KEY=                          # API key from Settings → API Access in Practice Better
PB_WEBHOOK_SECRET=                   # Secret shown when registering webhook in Practice Better
PB_API_BASE_URL=https://api.practicebetter.io/v1  # Verify this URL from PB docs
```

- [ ] **Step 2: Add real values to `.env.local`**

Once you receive API access from Practice Better, add the actual values:

```bash
PB_API_KEY=<your-key-here>
PB_WEBHOOK_SECRET=<your-webhook-secret-here>
PB_API_BASE_URL=https://api.practicebetter.io/v1
```

- [ ] **Step 3: Commit env.example**

```bash
git add .env.example
git commit -m "chore: add Practice Better env vars to .env.example"
```

---

## Task 3: Practice Better API Client

> ⚠️ Blocked until PB API key is received. Verify the exact endpoint paths (`/clients`) against the PB API documentation before implementing.

**Files:**
- Create: `src/lib/integrations/practice-better.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/lib/integrations/practice-better.ts

const PB_API_BASE = process.env.PB_API_BASE_URL ?? 'https://api.practicebetter.io/v1'
const PB_API_KEY  = process.env.PB_API_KEY ?? ''

export type PbClientInput = {
  first_name: string
  last_name:  string
  email:      string | null
  phone:      string | null
}

export type PbClient = {
  id:         string
  first_name: string
  last_name:  string
  email:      string | null
  phone:      string | null
}

async function pbFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${PB_API_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${PB_API_KEY}`,
      'Content-Type':  'application/json',
      ...(options.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`[PB API] ${res.status} on ${path}: ${body}`)
  }
  return res.json()
}

export async function createPbClient(input: PbClientInput): Promise<PbClient> {
  return pbFetch('/clients', {
    method: 'POST',
    body:   JSON.stringify(input),
  }) as Promise<PbClient>
}

export async function getPbClient(pbClientId: string): Promise<PbClient> {
  return pbFetch(`/clients/${pbClientId}`) as Promise<PbClient>
}
```

- [ ] **Step 2: TypeScript check**

```powershell
cd C:\Users\thead\proyectosagentic-crm
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/practice-better.ts
git commit -m "feat: add Practice Better API client (createPbClient, getPbClient)"
```

---

## Task 4: Sync Action — CRM → Practice Better

**Files:**
- Modify: `src/app/(app)/leads/[id]/actions.ts` (append only — do not touch existing functions)

- [ ] **Step 1: Add import at top of file**

Open `src/app/(app)/leads/[id]/actions.ts`. Find the existing imports block and add:

```typescript
import { createPbClient } from '@/lib/integrations/practice-better'
```

- [ ] **Step 2: Append `syncLeadToPracticeBetter` at the bottom of the file**

```typescript
export async function syncLeadToPracticeBetter(leadId: string): Promise<{ ok: boolean; pb_client_id?: string; error?: string }> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: lead, error: fetchError } = await supabase
    .from('leads')
    .select('id, first_name, last_name, email, phone, pb_client_id')
    .eq('id', leadId)
    .single()

  if (fetchError || !lead) {
    return { ok: false, error: 'Lead not found' }
  }

  // Already synced — idempotent
  if (lead.pb_client_id) {
    return { ok: true, pb_client_id: lead.pb_client_id }
  }

  try {
    const pbClient = await createPbClient({
      first_name: lead.first_name ?? '',
      last_name:  lead.last_name  ?? '',
      email:      lead.email,
      phone:      lead.phone,
    })

    await supabase
      .from('leads')
      .update({
        pb_client_id: pbClient.id,
        pb_synced_at: new Date().toISOString(),
      })
      .eq('id', leadId)

    return { ok: true, pb_client_id: pbClient.id }
  } catch (err) {
    console.error('[PB] syncLeadToPracticeBetter failed:', err)
    return { ok: false, error: String(err) }
  }
}
```

- [ ] **Step 3: Verify the file uses `createClient` already**

Check that `createClient` from `@supabase/supabase-js` is already imported at the top of `actions.ts`. If it uses a different pattern (e.g., `createServerClient`), match that pattern instead.

- [ ] **Step 4: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/leads/[id]/actions.ts
git commit -m "feat: add syncLeadToPracticeBetter server action"
```

---

## Task 5: Trigger Sync on Sale Paid

**Files:**
- Modify: `src/app/(app)/leads/[id]/_components/sale-actions.tsx` (add one call)

- [ ] **Step 1: Open `sale-actions.tsx` and find where `payment_status` is set to `'paid'`**

Search for the string `'paid'` in the file. There will be an update call like:
```typescript
await supabase.from('sales').update({ payment_status: 'paid' }).eq('id', saleId)
// or a server action that calls an API
```

Find the block where a sale is successfully marked as paid and the `leadId` is known.

- [ ] **Step 2: Import the sync action at the top of the file**

```typescript
import { syncLeadToPracticeBetter } from '@/app/(app)/leads/[id]/actions'
```

- [ ] **Step 3: Call sync after successful paid update**

Immediately after the successful `payment_status: 'paid'` update, add:

```typescript
// Fire-and-forget — don't block the sale update on PB sync
syncLeadToPracticeBetter(leadId).catch((err) =>
  console.error('[PB] background sync failed:', err)
)
```

Where `leadId` is the lead UUID associated with the sale. If `leadId` is not already in scope, look for `lead_id` on the sale record — you may need to fetch it first:

```typescript
const { data: sale } = await supabase.from('sales').select('lead_id').eq('id', saleId).single()
if (sale?.lead_id) {
  syncLeadToPracticeBetter(sale.lead_id).catch((err) =>
    console.error('[PB] background sync failed:', err)
  )
}
```

- [ ] **Step 4: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/leads/[id]/_components/sale-actions.tsx
git commit -m "feat: trigger Practice Better client sync when sale marked paid"
```

---

## Task 6: Webhook Endpoint — Practice Better → CRM

> ⚠️ Blocked until PB webhook secret is received. Also verify the exact payload field names (e.g. `data.client?.id`, `data.starts_at`) against real PB webhook docs before deploying. Register webhook URL in PB dashboard once deployed: `https://proyectosagentic-crm.vercel.app/api/webhooks/practicebetter`

**Files:**
- Create: `src/app/api/webhooks/practicebetter/route.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/app/api/webhooks/practicebetter/route.ts
import { createHmac, timingSafeEqual } from 'crypto'
import { createClient }                 from '@supabase/supabase-js'
import { NextRequest, NextResponse }    from 'next/server'

function verifySignature(rawBody: string, signature: string): boolean {
  const secret = process.env.PB_WEBHOOK_SECRET ?? ''
  if (!secret || !signature) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function resolveLeadId(
  supabase: ReturnType<typeof serviceClient>,
  pbClientId: string | null,
  email:      string | null,
  phone:      string | null
): Promise<string | null> {
  if (pbClientId) {
    const { data } = await supabase
      .from('leads')
      .select('id')
      .eq('pb_client_id', pbClientId)
      .single()
    if (data?.id) return data.id
  }

  if (email) {
    const { data } = await supabase
      .from('leads')
      .select('id')
      .ilike('email', email)
      .limit(1)
      .single()
    if (data?.id) {
      if (pbClientId) {
        await supabase.from('leads')
          .update({ pb_client_id: pbClientId, pb_synced_at: new Date().toISOString() })
          .eq('id', data.id)
      }
      return data.id
    }
  }

  if (phone) {
    const { data } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single()
    if (data?.id) {
      if (pbClientId) {
        await supabase.from('leads')
          .update({ pb_client_id: pbClientId, pb_synced_at: new Date().toISOString() })
          .eq('id', data.id)
      }
      return data.id
    }
  }

  return null
}

export async function POST(req: NextRequest) {
  const rawBody  = await req.text()
  const signature = req.headers.get('x-practice-better-signature') ?? ''

  if (!verifySignature(rawBody, signature)) {
    console.warn('[PB webhook] Invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: { event_type: string; data: Record<string, unknown> }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { event_type, data } = payload
  const supabase = serviceClient()

  switch (event_type) {
    case 'appointment.created':
    case 'appointment.updated':
    case 'appointment.cancelled': {
      const pbClientId = (data.client as any)?.id ?? (data.client_id as string) ?? null
      const email      = (data.client as any)?.email ?? null
      const phone      = (data.client as any)?.phone ?? null

      const leadId = await resolveLeadId(supabase, pbClientId, email, phone)
      if (!leadId) {
        console.warn('[PB webhook] No lead for appointment event, pb_client_id:', pbClientId)
        return NextResponse.json({ ok: true, skipped: true })
      }

      const status = event_type === 'appointment.cancelled'
        ? 'cancelled'
        : ((data.status as string) ?? 'scheduled')

      await supabase.from('pb_appointments').upsert({
        lead_id:          leadId,
        pb_appointment_id: data.id as string,
        status,
        scheduled_at:     (data.starts_at ?? data.scheduled_at) as string,
        completed_at:     (data.completed_at as string) ?? null,
        appointment_type: (data.type ?? data.appointment_type as string) ?? null,
      }, { onConflict: 'pb_appointment_id' })

      break
    }

    case 'payment.created': {
      const pbClientId = (data.client as any)?.id ?? (data.client_id as string) ?? null
      const email      = (data.client as any)?.email ?? null
      const phone      = (data.client as any)?.phone ?? null

      const leadId = await resolveLeadId(supabase, pbClientId, email, phone)
      if (!leadId) {
        console.warn('[PB webhook] No lead for payment event, pb_client_id:', pbClientId)
        return NextResponse.json({ ok: true, skipped: true })
      }

      const amountDollars = (data.amount as number) ?? 0

      await supabase.from('pb_payments').upsert({
        lead_id:       leadId,
        pb_payment_id: data.id as string,
        amount_cents:  Math.round(amountDollars * 100),
        status:        (data.status as string) ?? 'paid',
        paid_at:       (data.paid_at ?? data.created_at as string) ?? null,
        description:   (data.description as string) ?? null,
      }, { onConflict: 'pb_payment_id' })

      break
    }

    default:
      // Unknown event — acknowledge and ignore
      break
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/practicebetter/route.ts
git commit -m "feat: add Practice Better webhook endpoint with HMAC-SHA256 verification"
```

- [ ] **Step 4: After deploying, register webhook URL in Practice Better dashboard**

URL to register: `https://proyectosagentic-crm.vercel.app/api/webhooks/practicebetter`

Events to subscribe: `appointment.created`, `appointment.updated`, `appointment.cancelled`, `payment.created`

Copy the webhook secret shown and add it to Vercel env vars as `PB_WEBHOOK_SECRET`.

---

## Task 7: PracticeBetterCard Component

**Files:**
- Create: `src/components/leads/PracticeBetterCard.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/components/leads/PracticeBetterCard.tsx
import { createClient } from '@supabase/supabase-js'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

type Props = { leadId: string }

async function fetchPbData(leadId: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [{ data: lead }, { data: appointments }, { data: payments }] = await Promise.all([
    supabase
      .from('leads')
      .select('pb_client_id, pb_synced_at')
      .eq('id', leadId)
      .single(),
    supabase
      .from('pb_appointments')
      .select('id, status, scheduled_at, appointment_type')
      .eq('lead_id', leadId)
      .order('scheduled_at', { ascending: false }),
    supabase
      .from('pb_payments')
      .select('id, amount_cents, paid_at, status')
      .eq('lead_id', leadId)
      .order('paid_at', { ascending: false }),
  ])

  return { lead, appointments: appointments ?? [], payments: payments ?? [] }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-MX', {
    month: 'short',
    day:   'numeric',
    year:  'numeric',
  })
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('es-MX', {
    style:    'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

export async function PracticeBetterCard({ leadId }: Props) {
  const { lead, appointments, payments } = await fetchPbData(leadId)

  const isSynced = !!lead?.pb_client_id

  const totalPayments = payments
    .filter(p => p.status === 'paid')
    .reduce((sum, p) => sum + (p.amount_cents ?? 0), 0)

  const lastPayment = payments.find(p => p.status === 'paid')

  const upcomingAppointments = appointments.filter(
    a => a.status === 'scheduled' && new Date(a.scheduled_at) > new Date()
  )
  const nextAppointment = upcomingAppointments[0]

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Practice Better</CardTitle>
        {isSynced ? (
          <Badge variant="outline" className="text-green-600 border-green-600">
            ✓ Activo
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Sin sincronizar
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {!isSynced ? (
          <p className="text-xs text-muted-foreground">
            Se enviará a Practice Better automáticamente al cerrar la venta.
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Citas</span>
              <span>
                {appointments.length} total
                {nextAppointment && (
                  <span className="text-muted-foreground ml-1">
                    · próxima {formatDate(nextAppointment.scheduled_at)}
                  </span>
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pagos</span>
              <span>
                {formatMoney(totalPayments)}
                {lastPayment?.paid_at && (
                  <span className="text-muted-foreground ml-1">
                    · último {formatDate(lastPayment.paid_at)}
                  </span>
                )}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/leads/PracticeBetterCard.tsx
git commit -m "feat: add PracticeBetterCard server component for lead profile"
```

---

## Task 8: Add Card to Lead Profile Page

**Files:**
- Modify: `src/app/(app)/leads/[id]/page.tsx` (add import + one JSX element)

- [ ] **Step 1: Add import**

Open `src/app/(app)/leads/[id]/page.tsx`. At the top, with the other component imports, add:

```typescript
import { PracticeBetterCard } from '@/components/leads/PracticeBetterCard'
```

- [ ] **Step 2: Add the card to the JSX**

In the page JSX, find the activity timeline card (around line 206–224 based on codebase structure). Add `<PracticeBetterCard>` immediately after the closing tag of the activity timeline card and before the payment plans card:

```tsx
{/* Practice Better — sync status, appointments, payments */}
<PracticeBetterCard leadId={lead.id} />
```

If the lead detail page uses role-based filtering (provider users see limited info), place this card in the section visible to all roles — it contains no medical data.

- [ ] **Step 3: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Build check**

```powershell
npx next build 2>&1 | Select-String -Pattern "error|Error" | Select-Object -First 20
```

Expected: no build errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/leads/[id]/page.tsx
git commit -m "feat: add PracticeBetterCard to lead profile"
```

---

## Task 9: Deploy and Test

- [ ] **Step 1: Add env vars to Vercel**

```powershell
npx vercel env add PB_API_KEY production
npx vercel env add PB_WEBHOOK_SECRET production
npx vercel env add PB_API_BASE_URL production
```

- [ ] **Step 2: Deploy**

```powershell
npx vercel --prod --yes
```

Copy the new deploy URL from output.

- [ ] **Step 3: Update aliases**

```powershell
npx vercel alias set <NEW_DEPLOY_URL> proyectosagentic-crm.vercel.app
npx vercel alias set <NEW_DEPLOY_URL> agentic-crm-sigma.vercel.app
```

- [ ] **Step 4: Test webhook with PB webhook tester**

In Practice Better dashboard → Settings → API Access → Webhooks, use the built-in tester to send a test `appointment.created` event to `https://proyectosagentic-crm.vercel.app/api/webhooks/practicebetter`.

Expected: HTTP 200 `{"ok":true}` response. Check Supabase → `pb_appointments` table for the test row.

- [ ] **Step 5: Test the sync trigger**

Open an existing lead in the CRM that has a sale. Mark the sale as paid. Confirm in Supabase that `leads.pb_client_id` is now populated for that lead and a client was created in Practice Better.

- [ ] **Step 6: Verify card renders**

Open the lead profile in the browser. Confirm the "Practice Better" card appears:
- Unsync'd leads: shows "Sin sincronizar"
- Synced leads: shows appointment count and payment total

---

## Payload Field Names — Verify Against PB Docs

Once the API key arrives and you have the full PB documentation, verify these field names against actual webhook payloads before deploying Task 6:

| Assumed field | Where used | Verify |
|---|---|---|
| `data.id` | Appointment/payment ID | ✓ verify |
| `data.client.id` | PB client ID | ✓ verify |
| `data.client.email` | Fallback match | ✓ verify |
| `data.client.phone` | Fallback match | ✓ verify |
| `data.starts_at` | Appointment start time | ✓ verify — might be `scheduled_at` |
| `data.status` | Appointment status values | ✓ verify — might be `confirmed`, `no_show` |
| `data.amount` | Payment amount in dollars | ✓ verify — might be in cents |
| `data.paid_at` | Payment timestamp | ✓ verify — might be `created_at` |
| `data.type` | Appointment type label | ✓ verify |

If field names differ, update the `switch` block in `route.ts` accordingly before registering the webhook.
