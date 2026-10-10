-- Aviso de seguridad de Supabase (function_search_path_mutable): fija el
-- search_path de funciones auxiliares que no lo tenían. No cambia su lógica.
-- `extensions` queda incluido por si alguna usa unaccent u otra extensión.
-- Rollback: alter function ... reset search_path.
alter function public.crm_fold_text(text) set search_path = public, extensions, pg_temp;
alter function public.crm_legacy_conversation_state(text) set search_path = public, extensions, pg_temp;
alter function public.crm_normalize_business_name(text) set search_path = public, extensions, pg_temp;
alter function public.crm_normalize_city(text) set search_path = public, extensions, pg_temp;
alter function public.crm_normalize_domain(text) set search_path = public, extensions, pg_temp;
alter function public.crm_normalize_email(text) set search_path = public, extensions, pg_temp;
alter function public.crm_normalize_instagram(text) set search_path = public, extensions, pg_temp;
alter function public.crm_normalize_phone(text) set search_path = public, extensions, pg_temp;
alter function public.set_turno_times() set search_path = public, extensions, pg_temp;
alter function public.set_updated_at() set search_path = public, extensions, pg_temp;
