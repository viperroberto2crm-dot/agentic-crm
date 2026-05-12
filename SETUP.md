# Setup local — Agentic CRM

## Pre-requisitos

- Node.js 20 o superior ([https://nodejs.org](https://nodejs.org))
- npm 10+ (viene con Node)
- Tu Supabase ya configurada (URL + keys en Settings → API)

## 1. Copiar el proyecto a tu compu

Desde PowerShell (Windows), copia esta carpeta a donde quieras tener tu código:

```powershell
xcopy /E /I "RUTA\A\outputs\agentic-crm-app" "C:\Users\TuUsuario\Code\agentic-crm"
cd C:\Users\TuUsuario\Code\agentic-crm
```

(Cambia `TuUsuario` y la ruta al de tu compu.)

## 2. Instalar dependencias

```bash
npm install
```

## 3. Crear `.env.local`

Copia `.env.example` a `.env.local`:

```powershell
copy .env.example .env.local
```

Edita `.env.local` y pega tus valores reales. Los obtienes de:
**Supabase → Settings → API**

```env
NEXT_PUBLIC_SUPABASE_URL=https://cwsyhjxbyyakcbxcwhib.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...      # <-- "anon public" key
SUPABASE_SERVICE_ROLE_KEY=eyJ...           # <-- "service_role" key (PRIVADA)
NEXT_PUBLIC_APP_URL=http://localhost:3000
COMPANY_NAME=Si Se Pierde / Sunny Slim
```

⚠️ **NUNCA subas `.env.local` a git ni la compartas.** Está en `.gitignore`.

## 4. Correr el dev server

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

## Qué deberías ver

1. Te redirige a `/login`.
2. Pones tu email + password (los que creaste en Supabase Auth).
3. Click "Entrar" → te lleva a `/dashboard`.
4. Verás:
   - "Hola, Roberto Godinez"
   - Rol: **admin**
   - Sección "Tus marcas" con las 2: Si Se Pierde + Sunny Slim
5. Click "Salir" → vuelve a `/login`.

## Troubleshooting

**No me deja entrar / "Email o contraseña inválidos":**
- Confirma email exacto en Supabase → Authentication → Users.
- Si olvidaste la password: Supabase Auth → click el usuario → "Send password recovery".

**"failed to fetch" o no carga nada:**
- Revisa que `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` estén bien copiados.
- Reinicia `npm run dev` después de cambiar `.env.local`.

**Entro pero el dashboard dice "No tienes marcas asignadas":**
- Confirma que corriste el INSERT del Paso 10 anterior. Verifica con SQL:

```sql
SELECT u.email, b.name FROM users u
JOIN user_brands ub ON ub.user_id = u.id
JOIN brands b ON b.id = ub.brand_id
WHERE u.email = 'viperroberto2.crm@gmail.com';
```

Debe devolver 2 filas.

**"User not found in public.users":**
- El usuario está en `auth.users` pero falta el espejo en `public.users`. Re-corre
  el bloque de INSERTs del Paso 10.

## Estructura del proyecto

```
agentic-crm-app/
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── .env.example
├── .gitignore
├── SETUP.md                     ← este archivo
└── src/
    ├── middleware.ts            ← redirige a /login si no hay sesión
    ├── lib/
    │   └── supabase/
    │       ├── client.ts        ← cliente de Supabase (browser)
    │       ├── server.ts        ← cliente de Supabase (server / RSC)
    │       └── middleware.ts    ← helper para validar sesión en middleware
    └── app/
        ├── layout.tsx
        ├── page.tsx             ← redirige a /dashboard
        ├── globals.css
        ├── login/
        │   ├── page.tsx         ← formulario de login
        │   └── actions.ts       ← server action de signInWithPassword
        ├── auth/
        │   └── actions.ts       ← server action de signOut
        └── dashboard/
            └── page.tsx         ← muestra usuario + marcas
```

## Próximo paso (cuando vuelvas)

Construir `/leads`:
- Lista filtrada por marca activa
- Filtros (status, asignado a, búsqueda)
- Botón "Nuevo lead" con modal
- Click en un lead → `/leads/[id]` con timeline + botones de captura
