-- Fixture mínimo del SQL real: no es una prueba contra QA ni el esquema completo.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create table public.barberias (id bigint primary key, metadata jsonb not null default '{}', zona_horaria text);
create table public.saas_integraciones (id bigint primary key, barberia_id bigint references public.barberias(id), proveedor text, integration_type text, external_instance_id text);
create table public.saas_whatsapp_connections (id bigint primary key, barberia_id bigint references public.barberias(id), integration_id bigint references public.saas_integraciones(id), provider text, environment text, state text, instance_name text, automation_enabled boolean, outbound_enabled boolean, booking_enabled boolean);
create table public.clientes (id bigint generated always as identity primary key, barberia_id bigint not null references public.barberias(id), nombre text not null, telefono text, email text, unique(barberia_id, telefono));
create table public.mensajes (id bigint generated always as identity primary key, barberia_id bigint not null references public.barberias(id), cliente_id bigint references public.clientes(id), paciente text not null, texto text not null, de text not null check(de in ('paciente','bot','clinica')), hora text, leido boolean default false, enviado_wsp boolean default false, created_at timestamptz default now(), telefono text, whatsapp_id text, estado_envio text not null default 'enviado' check(estado_envio in ('enviado','pendiente','recibido_n8n','aceptado','entregado','incierto','fallido')));
create table public.config (barberia_id bigint, clave text, valor text, unique(barberia_id,clave));
alter table public.clientes enable row level security;
alter table public.mensajes enable row level security;
grant select on public.clientes, public.mensajes to anon, authenticated;
-- Sin políticas para estos roles: ven cero filas, igual antes y después.
insert into public.barberias values
 (928,'{"environment":"qa","whatsapp_manual_testing_authorized":true}','America/Argentina/Buenos_Aires'),
 (927,'{"environment":"qa"}','America/Argentina/Buenos_Aires');
insert into public.saas_integraciones values (48,928,'evolution','whatsapp','austral-qa-tenant-928'),(47,927,'evolution','whatsapp','austral-qa-tenant-927');
insert into public.saas_whatsapp_connections values (6,928,48,'evolution','qa','CONNECTED','austral-qa-tenant-928',true,true,true),(5,927,47,'evolution','qa','CONNECTED','austral-qa-tenant-927',false,false,false);
insert into public.config values (928,'bot_activo','false');
create function public.t_assert(ok boolean, msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %', msg; end if; raise notice 'PASS: %', msg; end $$;
