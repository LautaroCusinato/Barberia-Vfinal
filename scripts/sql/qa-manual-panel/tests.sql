-- Sólo fixtures locales. No envía nada a n8n/Evolution.
create or replace function public.qa_assert(cond boolean,msg text) returns void language plpgsql as $$
begin if not coalesce(cond,false) then raise exception 'FAIL: %',msg; end if; end $$;
alter table public.barberias add column slug text, add column metadata jsonb default '{}'::jsonb;
insert into public.barberias(id,nombre,slug,metadata) values
 (928,'QA local','austral-prueba-lautaro','{"environment":"qa","whatsapp_manual_testing_authorized":true}');
insert into public.clientes(barberia_id,nombre,telefono) values (928,'Cliente local','5491155550107');

select public.qa_assert(not has_function_privilege('anon','public.reservar_envio_panel_qa_manual(bigint,bigint,uuid,text,text[],text,boolean,integer,integer,integer,integer)','execute'),'anon no ejecuta');
select public.qa_assert(not has_function_privilege('authenticated','public.reservar_envio_panel_qa_manual(bigint,bigint,uuid,text,text[],text,boolean,integer,integer,integer,integer)','execute'),'authenticated no ejecuta');
set role service_role;
do $$ declare r jsonb; c bigint; begin
 select id into c from public.clientes where barberia_id=928;
 r:=public.reservar_envio_panel_qa_manual(928,c,'6e34a866-3d71-41ae-a54e-d2df183134ff','Uno',array['5491155550107']);
 perform public.qa_assert(r->>'status'='reserved','servicio reserva destino permitido');
 r:=public.reservar_envio_panel_qa_manual(928,c,'6e34a866-3d71-41ae-a54e-d2df183134ff','Uno',array['5491155550107']);
 perform public.qa_assert(r->>'status'='replay','mismo identificador no duplica');
 r:=public.reservar_envio_panel_qa_manual(927,c,gen_random_uuid(),'Ajeno',array['5491155550107']);
 perform public.qa_assert(r->>'status'='qa_manual_not_authorized','otro negocio rechazado');
 r:=public.reservar_envio_panel_qa_manual(928,4,gen_random_uuid(),'Ajeno',array['5491155550107']);
 perform public.qa_assert(r->>'status'='customer_not_found','cliente ajeno rechazado');
end $$;
reset role;
update public.mensajes set estado_envio='incierto' where barberia_id=928;
update public.clientes set telefono='5491155559999' where barberia_id=928;
set role service_role;
do $$ declare r jsonb; c bigint; begin
 select id into c from public.clientes where barberia_id=928;
 r:=public.reservar_envio_panel_qa_manual(928,c,'6e34a866-3d71-41ae-a54e-d2df183134ff','Uno',array['5491155550107'],null,true);
 perform public.qa_assert(r->>'status'='qa_recipient_not_allowed','rechazo antes de reservar');
 perform public.qa_assert((select estado_envio from public.mensajes where barberia_id=928)='incierto','conserva incertidumbre de intento anterior');
 perform public.qa_assert((select count(*) from public.mensajes where barberia_id=928)=1,'no crea otra fila');
 begin
   perform public.reservar_envio_panel_qa_manual(928,c,gen_random_uuid(),'Sin lista',array[]::text[]);
   raise exception 'FAIL: aceptó lista vacía';
 exception when invalid_parameter_value then null; end;
end $$;
reset role;
delete from public.mensajes where barberia_id=928;
delete from public.config where barberia_id=928;
update public.clientes set telefono='5491155550107' where barberia_id=928;
select 'QA manual panel: scope, permisos, replay e incertidumbre PASS';
