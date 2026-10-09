set role service_role;
select public.registrar_mensaje_whatsapp_qa928(48,'web:promote','paciente','5491155552851','Hola',now(),'web-promote');
reset role;
set role anon;
select * from public.crear_reserva_publica('austral-prueba-lautaro',71,65,current_date+2,'11:00','Ana Web','5491155552851',null);
reset role;
select public.t_assert((select nombre='Ana Web' and not whatsapp_nombre_pendiente from public.clientes where barberia_id=928 and telefono='5491155552851'),'WhatsApp luego web completa la misma ficha');
select public.t_assert((select count(*)=1 from public.clientes where barberia_id=928 and telefono='5491155552851'),'una ficha, no una por canal');

-- Un nombre real previo y una edición del equipo prevalecen.
update public.clientes set nombre='Nombre del equipo',whatsapp_nombre_pendiente=true where barberia_id=928 and telefono='5491155552851';
set role anon;
select * from public.crear_reserva_publica('austral-prueba-lautaro',71,65,current_date+3,'12:00','Otro Nombre','5491155552851',null);
reset role;
select public.t_assert((select nombre='Nombre del equipo' from public.clientes where barberia_id=928 and telefono='5491155552851'),'no reemplaza nombre editado aunque el marcador esté pendiente');

insert into public.clientes (barberia_id,nombre,telefono,whatsapp_nombre_pendiente) values (927,'Contacto WhatsApp · …2851','5491155552851',true);
set role anon;
select * from public.crear_reserva_publica('otro-qa',72,66,current_date+2,'11:00','Nombre Otro','5491155552851',null);
reset role;
select public.t_assert((select nombre='Contacto WhatsApp · …2851' and whatsapp_nombre_pendiente from public.clientes where barberia_id=927 and telefono='5491155552851'),'otro negocio conserva su contrato');

-- Metadata de autorización apagada: no se amplía el alcance.
set role service_role;
select public.registrar_mensaje_whatsapp_qa928(48,'web:noauth','paciente','5491155550307','Hola',now(),'web-noauth');
reset role;
update public.barberias set metadata='{"environment":"qa"}' where id=928;
set role anon;
select * from public.crear_reserva_publica('austral-prueba-lautaro',71,65,current_date+4,'13:00','Nombre Web','5491155550307',null);
reset role;
select public.t_assert((select whatsapp_nombre_pendiente and nombre='Contacto WhatsApp · …0307' from public.clientes where barberia_id=928 and telefono='5491155550307'),'sin autorización no promueve');
update public.barberias set metadata='{"environment":"qa","whatsapp_manual_testing_authorized":true}' where id=928;
set role anon;
select public.t_assert((select count(*)=0 from public.clientes),'RLS no concede acceso anónimo a fichas');
reset role;
select public.t_assert((select relrowsecurity from pg_class where oid='public.clientes'::regclass),'RLS permanece habilitada');
