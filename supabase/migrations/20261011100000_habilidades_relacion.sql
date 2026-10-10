-- Habilidades de cada profesional: barbero_servicios es la única fuente
-- (la usan la reserva web, el bot y ahora también el panel). Algunos
-- profesionales tenían habilidades marcadas en el panel (barberos.habilidades,
-- texto con el nombre del servicio) pero ninguna fila en barbero_servicios: la
-- web y WhatsApp no podían reservarlos. Esta reparación copia esas
-- habilidades sólo para quienes no tienen ninguna relación cargada.
-- Idempotente. Rollback: borrar las filas insertadas (no se modifica nada más).
-- Sólo si existe la columna heredada (QA no la tiene).
do $mig$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'barberos' and column_name = 'habilidades') then
    execute $sql$
insert into public.barbero_servicios (barbero_id, servicio_id)
select distinct b.id, s.id
from public.barberos b
cross join lateral jsonb_array_elements_text(
  case when b.habilidades ~ '^\s*\[' then b.habilidades::jsonb else '[]'::jsonb end
) h(slug)
join public.servicios s
  on s.barberia_id = b.barberia_id
 and regexp_replace(regexp_replace(lower(translate(s.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', '_', 'g'), '[^a-z0-9_]', '', 'g') = h.slug
where not exists (select 1 from public.barbero_servicios bs where bs.barbero_id = b.id)
on conflict do nothing
    $sql$;
  end if;
end
$mig$;
