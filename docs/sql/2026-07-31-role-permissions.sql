-- 2026-07-31 · Permisos operativos editables por rol (toggles seguros)
-- ============================================================================
-- Guarda qué capacidades OPERATIVAS SEGURAS tiene cada rol (rep/manager). El
-- admin siempre las tiene; el provider nunca (piso duro de seguridad en código).
-- Los permisos CRÍTICOS (aislamiento de pacientes por marca, provider sin dinero)
-- NO viven aquí: siguen fijos en el código y en RLS.
--
-- Si una fila no existe, el código usa el DEFAULT (= comportamiento actual). Así,
-- correr esto (o no) no cambia nada hasta que el admin toque un toggle.
-- Correr en Supabase → SQL Editor → Run.
-- ============================================================================

create table if not exists role_permissions (
  role        text not null,        -- 'rep' | 'manager'
  capability  text not null,        -- see_all_leads | reassign_leads | bulk_delete | charge | send_sms | export_data
  allowed     boolean not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users(id) on delete set null,
  primary key (role, capability)
);

alter table role_permissions enable row level security;
drop policy if exists "auth read role_permissions"  on role_permissions;
drop policy if exists "service all role_permissions" on role_permissions;
-- Lectura para cualquier usuario autenticado (cada quien necesita saber qué puede
-- hacer su propio rol; no es dato sensible). Escritura solo service_role (la
-- acción de guardar valida admin en el servidor).
create policy "auth read role_permissions"  on role_permissions for select to authenticated using (true);
create policy "service all role_permissions" on role_permissions for all to service_role using (true) with check (true);

-- Verificación:
select exists (select 1 from information_schema.tables where table_name = 'role_permissions') as tabla_creada;
