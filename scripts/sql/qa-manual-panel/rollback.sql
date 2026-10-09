-- Sólo quita el wrapper QA; no modifica mensajes, contactos ni la RPC general.
begin;
drop function if exists public.reservar_envio_panel_qa_manual(bigint,bigint,uuid,text,text[],text,boolean,integer,integer,integer,integer);
commit;
