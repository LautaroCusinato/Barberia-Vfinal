-- Índices de soporte para claves foráneas consultadas por agenda, clientes,
-- mensajes y pagos. No cambia datos ni políticas RLS.
begin;

create index if not exists idx_bloqueos_agenda_barbero
  on public.bloqueos_agenda (barbero_id);

create index if not exists idx_horarios_barbero_barberia
  on public.horarios_barbero (barberia_id);

create index if not exists idx_mensajes_cliente
  on public.mensajes (cliente_id);

create index if not exists idx_notas_cliente
  on public.notas (cliente_id);

-- `pagos` existe en el proyecto desplegado actual, pero no estaba en el
-- esquema histórico inicial. La condición mantiene la migración ejecutable
-- también en una instalación limpia que todavía no tenga ese módulo.
do $$
begin
  if to_regclass('public.pagos') is not null then
    execute 'create index if not exists idx_pagos_barberia on public.pagos (barberia_id)';
    execute 'create index if not exists idx_pagos_cliente on public.pagos (cliente_id)';
    execute 'create index if not exists idx_pagos_turno on public.pagos (turno_id)';
  end if;
end
$$;

create index if not exists idx_turnos_cliente
  on public.turnos (cliente_id);

create index if not exists idx_turnos_servicio
  on public.turnos (servicio_id);

commit;
