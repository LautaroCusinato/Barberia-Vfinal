-- Estado de conexión WhatsApp por tenant y entorno.
-- La tabla no guarda tokens, headers, webhooks ni el contenido del QR.
-- El acceso queda restringido a service_role; la Edge Function valida sesión,
-- membresía owner/admin y proyecto antes de escribir.
begin;

create table if not exists public.saas_whatsapp_connections (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  integration_id bigint references public.saas_integraciones(id) on delete set null,
  provider text not null default 'evolution' check (provider = 'evolution'),
  environment text not null default 'qa' check (environment in ('qa', 'sandbox', 'production')),
  provisioning_mode text not null default 'shadow' check (provisioning_mode in ('mock', 'shadow', 'live')),
  state text not null default 'NOT_CONFIGURED' check (state in (
    'NOT_CONFIGURED', 'CREATING_INSTANCE', 'QR_READY', 'CONNECTING',
    'CONNECTED', 'DISCONNECTED', 'ERROR'
  )),
  instance_name text,
  external_instance_id text,
  receiver_number text,
  qr_expires_at timestamptz,
  last_verified_at timestamptz,
  last_error_code text,
  last_error_message text check (last_error_message is null or char_length(last_error_message) <= 240),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barberia_id, environment)
);

create unique index if not exists uq_saas_whatsapp_connections_instance
  on public.saas_whatsapp_connections (lower(btrim(instance_name)))
  where instance_name is not null and btrim(instance_name) <> '';

create index if not exists idx_saas_whatsapp_connections_lookup
  on public.saas_whatsapp_connections (provider, environment, state, barberia_id);

alter table public.saas_whatsapp_connections enable row level security;
revoke all on table public.saas_whatsapp_connections from public, anon, authenticated;
grant select, insert, update, delete on table public.saas_whatsapp_connections to service_role;

drop trigger if exists trg_saas_whatsapp_connections_updated_at on public.saas_whatsapp_connections;
create trigger trg_saas_whatsapp_connections_updated_at
before update on public.saas_whatsapp_connections
for each row execute function public.set_updated_at();

commit;
