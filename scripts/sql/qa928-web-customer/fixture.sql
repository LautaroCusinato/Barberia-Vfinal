-- Se ejecuta después del stub de ficha única. Sólo cluster temporal local.
alter table public.barberias add column metadata jsonb not null default '{}';
alter table public.saas_integraciones add column external_instance_id text;
create table public.saas_whatsapp_connections (id bigint primary key, barberia_id bigint references public.barberias(id), integration_id bigint references public.saas_integraciones(id), provider text, environment text, instance_name text);
create table public.mensajes (id bigint generated always as identity primary key, barberia_id bigint references public.barberias(id), cliente_id bigint references public.clientes(id), paciente text, texto text, de text, hora text, leido boolean, enviado_wsp boolean, created_at timestamptz, telefono text, whatsapp_id text, estado_envio text);
insert into public.barberias (id,nombre,slug,metadata) values
 (928,'Manual QA','austral-prueba-lautaro','{"environment":"qa","whatsapp_manual_testing_authorized":true}'),
 (927,'Otro negocio','otro-qa','{"environment":"qa","whatsapp_manual_testing_authorized":true}');
insert into public.saas_integraciones values (48,928,'evolution','whatsapp','conectado','austral-qa-tenant-928');
insert into public.saas_whatsapp_connections values (6,928,48,'evolution','qa','austral-qa-tenant-928');
insert into public.servicios values (71,928,'Corte',15000,30,true),(72,927,'Corte',15000,30,true);
insert into public.barberos values (65,928,'Mateo',true),(66,927,'Otro',true);
insert into public.barbero_servicios values (65,71,null),(66,72,null);
insert into public.horarios_barbero select b,p,d,'08:00','21:00',true from generate_series(0,6) d cross join (values (928,65),(927,66)) v(b,p);
create function public.t_assert(ok boolean,msg text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',msg; end if; raise notice 'PASS: %',msg; end$$;
alter table public.clientes enable row level security;
grant select on public.clientes to anon, authenticated;
