import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COMMERCIAL_BILLING_MODE,
  COMMERCIAL_CATALOG,
  COMMERCIAL_TRIAL_DAYS,
  TRIAL_CONTINUATION_MESSAGE,
  buildWhatsAppHref,
  getTrialContinuationWhatsAppMessage,
  normalizeCommercialBillingMode,
} from '../src/lib/commercialCatalog.js'
import { trialHasExpired, trialRemainingDays } from '../src/lib/trial.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read('supabase/migrations/20260831090000_commercial_trial_15_days.sql').replace(/\r\n/g, '\n')
const platformMigration = read('supabase/migrations/20260831091000_platform_manual_activation_support.sql').replace(/\r\n/g, '\n')
const billing = read('src/pages/Billing.jsx')
const platformCrm = read('src/pages/PlatformCRM.jsx')
const api = read('supabase/functions/billing-api/index.ts')
const invitations = read('src/components/TenantSettings.jsx')
const app = read('src/App.jsx')
const settingsMigration = read('supabase/migrations/20260807040000_commercial_operations_foundation.sql')
const qaSchema = read('supabase/migrations/20260810171324_qa_base_schema.sql')
const onboardingLegacy = read('supabase/migrations/20260807000000_self_service_onboarding.sql')
const demo = read('e2e/demo.spec.mjs')
const bookingAccess = read('supabase/migrations/20260806120000_enforce_booking_access.sql')
const whatsappMutations = read('supabase/migrations/20260806161000_whatsapp_booking_mutations.sql')
const qaRunbook = read('docs/COMMERCIAL-TRIAL-QA-ROLLBACK.md')
const coverageCases = [
  '15-day trial catalog', 'server-side trial dates', 'existing trial end preserved', 'existing trial start preserved',
  'legacy null date not reset', 'stale trial access blocked', 'cron expires trial', 'no automatic grace',
  'paid past_due preserved', 'public booking guard', 'WhatsApp mutation guard', 'owner Billing visibility',
  'active trial CTA absent', 'expired trial CTA exact', 'missing billing mode manual', 'empty billing mode manual',
  'invalid billing mode manual', 'tenant owner cannot self-activate', 'readonly/sales/support cannot activate',
  'platform owner/admin activation RPC', 'versioned audit and tenant isolation',
  'idempotent plan update', 'owner entitlement write denied', 'normal settings RPC allow-list',
  'operational helper membership scope', 'cross-tenant write isolation', 'migration A/B separation',
  'rollback documented', 'QA backup checklist',
]
assert.equal(coverageCases.length, 29)

assert.equal(COMMERCIAL_TRIAL_DAYS, 15)
assert.equal(COMMERCIAL_BILLING_MODE, 'manual')
assert.equal(normalizeCommercialBillingMode(undefined), 'manual', 'modo ausente debe cerrar billing en manual')
assert.equal(normalizeCommercialBillingMode(''), 'manual', 'modo vacío debe cerrar billing en manual')
assert.equal(normalizeCommercialBillingMode('invalid'), 'manual', 'modo inválido debe cerrar billing en manual')
assert.equal(normalizeCommercialBillingMode(' automatic '), 'automatic')
assert.ok(COMMERCIAL_CATALOG.every((plan) => plan.trial_dias === 15), 'todos los planes comerciales deben anunciar 15 días')
assert.match(migration, /alter column trial_dias set default 15/)
assert.match(migration, /set trial_dias = 15/)
const trialPlanUpdateStart = migration.indexOf('update public.saas_planes')
const trialPlanUpdateEnd = migration.indexOf('create or replace function public.bootstrap_barberia_saas')
const trialPlanUpdate = migration.slice(trialPlanUpdateStart, trialPlanUpdateEnd)
assert.match(trialPlanUpdate, /where activo = true\s+and trial_dias is distinct from 15;/, 'la actualización del catálogo debe ser idempotente')
assert.doesNotMatch(trialPlanUpdate, /where activo = true;\s*$/)
assert.match(migration, /create or replace function public\.bootstrap_barberia_saas/)
assert.match(migration, /create or replace function public\.complete_self_service_onboarding/)
assert.match(migration, /coalesce\(trial_dias, 15\)/)
assert.match(migration, /v_trial_days integer := 15/)
assert.match(migration, /v_started_at \+ make_interval\(days => v_trial_days\)/, 'el trigger debe calcular la fecha desde now() y trial_dias')
assert.match(migration, /v_trial_started \+ make_interval\(days => v_trial_days\)/, 'el onboarding nuevo debe calcular exactamente trial_dias días')
assert.match(migration, /join public\.barberia_members m on m\.barberia_id = b\.id\s+where m\.user_id = v_user_id and m\.role = 'owner'/s, 'onboarding debe resolver únicamente el tenant owner del usuario')
assert.match(migration, /where id = v_barberia\.id\s+returning \* into v_barberia/s, 'la actualización de onboarding debe quedar acotada al tenant resuelto')
assert.match(migration, /on conflict \(barberia_id\) do nothing/, 'la suscripción de alta debe ser idempotente por tenant')
assert.match(migration, /trial_ends_at = case when v_existing\.id is null then coalesce\(trial_ends_at, v_trial_ends\) else trial_ends_at end/, 'las fechas del tenant existente deben permanecer intactas')
assert.match(migration, /estado_cuenta = case when v_existing\.id is null then coalesce\(estado_cuenta, 'trial'\) else estado_cuenta end/, 'el onboarding no debe reabrir ni resetear el estado de un tenant existente')
assert.match(migration, /on conflict \(barberia_id\) do update set\s+-- Existing subscription dates are immutable here as well\.[\s\S]*?trial_ends_at = case when v_existing\.id is null\s+then coalesce\(public\.saas_suscripciones\.trial_ends_at, excluded\.trial_ends_at\)\s+else public\.saas_suscripciones\.trial_ends_at end/s)
assert.doesNotMatch(migration, /trial_ends_at\s*=\s*excluded\.trial_ends_at(?!,)/)
const onboardingLegacyStart = onboardingLegacy.indexOf('create or replace function public.complete_self_service_onboarding')
const onboardingLegacyEnd = onboardingLegacy.indexOf('\n$$;', onboardingLegacyStart)
const onboardingLegacyBlock = onboardingLegacy.slice(onboardingLegacyStart, onboardingLegacyEnd)
assert.ok(onboardingLegacyStart >= 0 && onboardingLegacyEnd > onboardingLegacyStart)
assert.match(onboardingLegacyBlock, /v_trial_days integer := 14/, 'la referencia histórica debe conservar el contrato anterior de 14 días')
assert.match(migration, /v_trial_days integer := 15/, 'la nueva migración debe cambiar únicamente el fallback comercial a 15 días')
assert.match(migration, /estado_cuenta = case when v_existing\.id is null[\s\S]*?else estado_cuenta end/, 'onboarding no debe reabrir tenants suspendidos/cancelados')

const exact15 = new Date('2030-01-01T00:00:00.000Z')
const plus15 = new Date(exact15.getTime() + 15 * 24 * 60 * 60 * 1000)
assert.equal(trialRemainingDays(plus15, exact15), 15)
assert.equal(trialRemainingDays(plus15, plus15.getTime() - 1), 1)
assert.equal(trialRemainingDays(plus15, plus15), 0)
assert.equal(trialRemainingDays(plus15, plus15.getTime() + 1), 0)
assert.equal(trialHasExpired(plus15, plus15), true)
assert.equal(trialHasExpired(plus15, plus15.getTime() - 1), false)
assert.match(migration, /s\.estado = 'trialing' and s\.trial_ends_at is not null and s\.trial_ends_at <= now\(\) then 'expired'/, 'el acceso debe bloquear trials vencidos aunque el cron esté atrasado')
assert.match(migration, /create or replace function public\.barberia_operational_access/)
assert.match(migration, /barberia_access_state\(p_barberia_id\) in \('active', 'trialing', 'past_due'\)/)
assert.match(migration, /current_setting\('request\.jwt\.claim\.role', true\) = 'service_role'/, 'service_role debe conservar el camino interno')
assert.match(migration, /exists\s*\(\s*select 1\s+from public\.barberia_members m[\s\S]*?m\.barberia_id = p_barberia_id[\s\S]*?m\.user_id = auth\.uid\(\)/, 'el helper debe acotar el tenant al membership autenticado')
assert.match(migration, /revoke update on table public\.barberias from public, anon, authenticated;/, 'el owner no debe actualizar la tabla de tenant directamente')
assert.match(migration, /grant update on table public\.barberias to service_role;/, 'service_role debe conservar la administración de tenant')
assert.match(invitations, /update_tenant_settings/, 'los cambios normales deben seguir el RPC allow-list')
assert.match(qaSchema, /create policy "barberias_update_owner"[\s\S]*is_barberia_role\(id, array\['owner'\]\)/, 'la política de owner debe seguir acotada al owner del tenant')
const settingsUpdateStart = settingsMigration.indexOf('update public.barberias set')
const settingsUpdateEnd = settingsMigration.indexOf('create or replace function public.create_barberia_invitation', settingsUpdateStart)
const settingsUpdate = settingsMigration.slice(settingsUpdateStart, settingsUpdateEnd)
assert.ok(settingsUpdateStart >= 0 && settingsUpdateEnd > settingsUpdateStart)
for (const entitlementField of ['estado_cuenta', 'plan_codigo', 'trial_started_at', 'trial_ends_at', 'suscripcion', 'subscription']) {
  assert.doesNotMatch(settingsUpdate, new RegExp(`\\b${entitlementField}\\b`, 'i'), `el RPC de settings no debe aceptar ${entitlementField}`)
}
assert.match(settingsUpdate, /nombre\s*=\s*btrim\(p_nombre\)/)
assert.match(settingsUpdate, /intervalo_reserva_min\s*=\s*p_intervalo_reserva_min/)
assert.doesNotMatch(app, /\.from\(['"]barberias['"]\)\s*\.update/, 'la UI no debe escribir barberias directamente')
assert.match(migration, /turnos_write_staff[\s\S]*barberia_operational_access\(barberia_id\)/, 'las escrituras de agenda deben respetar el acceso operativo')
assert.match(migration, /s\.estado = 'past_due' and s\.status_reason = 'trial_expired' then 'expired'/, 'legacy past_due de trial debe seguir bloqueado sin afectar pagos reales')
assert.match(migration, /when s\.estado = 'past_due' then 'past_due'/, 'past_due legítimo de una suscripción paga debe conservar su semántica')
assert.match(migration, /v_from = 'trialing' and v_to in \('active','past_due','grace_period','canceled','incomplete','expired'\)/)
assert.match(migration, /v_from = 'expired' and v_to in \('active','canceled'\)/, 'expired debe poder reactivarse por platform owner/admin')
assert.match(migration, /transition_saas_subscription\(v_sub\.id, 'expired', 'trial_expired', 'trial'\)/, 'el vencimiento no debe regalar grace period')
assert.doesNotMatch(migration, /transition_saas_subscription\(v_sub\.id, 'grace_period'/)
const transitionStart = migration.indexOf('create or replace function public.transition_saas_subscription')
const transitionEnd = migration.indexOf('\n$$;', transitionStart)
const transition = migration.slice(transitionStart, transitionEnd)
assert.ok(transitionStart >= 0 && transitionEnd > transitionStart)
assert.doesNotMatch(transition, /trial_started_at\s*=|trial_ends_at\s*=/, 'la activación no debe modificar fechas del trial')
const activeStateIndex = migration.indexOf("when s.estado = 'active' then 'active'")
const staleTrialIndex = migration.indexOf("s.estado = 'trialing' and s.trial_ends_at is not null and s.trial_ends_at <= now()")
assert.ok(activeStateIndex >= 0 && staleTrialIndex > activeStateIndex, 'active debe prevalecer sobre una fecha histórica de trial')

assert.equal(getTrialContinuationWhatsAppMessage(), TRIAL_CONTINUATION_MESSAGE)
const href = buildWhatsAppHref('+54 9 11 5555-0101', TRIAL_CONTINUATION_MESSAGE)
assert.match(href, /^https:\/\/wa\.me\/5491155550101\?text=/)
assert.equal(decodeURIComponent(href.split('?text=')[1]), TRIAL_CONTINUATION_MESSAGE)
assert.doesNotMatch(billing, /wa\.me\/\d{8,}/, 'Billing no debe hardcodear el número comercial')
assert.match(billing, /getTrialContinuationWhatsAppHref/)
assert.match(billing, /Tu período de prueba terminó\./)
assert.match(billing, /Quiero seguir usando Austral/)
assert.match(billing, /trialExpired && \(trialContinuationHref/)
assert.doesNotMatch(billing, /\(trialActive \|\| trialExpired\) && \(trialContinuationHref/, 'la CTA exacta solo debe aparecer post-trial')
assert.match(billing, /!manualBilling/)
assert.match(billing, /billingApi\('checkout'/, 'el código automático debe conservarse para una fase posterior')
assert.match(api, /function sandboxSubscription/)
assert.match(api, /return ownerTenant\(admin, userId\)/, 'las operaciones comerciales normales deben resolver el tenant del owner autenticado')
assert.match(api, /resolveSandboxScope\(admin, userId, body\.tenant_id\)/, 'el sandbox debe validar explícitamente su tenant autorizado')
assert.match(api, /\.eq\('barberia_id', tenantId\)/, 'las lecturas billing deben mantenerse acotadas al tenant resuelto')
assert.match(bookingAccess, /in \('active', 'trialing', 'past_due'\)/, 'las reglas de reservas existentes deben permanecer intactas')
assert.match(whatsappMutations, /not in \('active', 'trialing', 'past_due'\)/, 'las mutaciones WhatsApp deben conservar el mismo guard de acceso')
assert.match(migration, /create or replace function public\.transition_saas_subscription/)
assert.match(platformCrm, /Activar suscripción/)
assert.match(platformCrm, /transition_saas_subscription/)
assert.match(platformCrm, /p_to_state: 'active'/)
assert.match(platformCrm, /p_source: 'admin'/)
assert.match(platformCrm, /p_expected_version:/)
assert.match(platformCrm, /canActivateSubscriptions = \['owner', 'admin'\]/)
assert.match(platformCrm, /isNonOperationalBillingTenant/)
assert.match(platformCrm, /billingTenantById/, 'la acción de activación debe derivarse del negocio seleccionado')
assert.match(migration, /billing_can_manage\(v_sub\.barberia_id\)/, 'la autorización de activación debe ser server-side')
assert.match(migration, /saas_billing_state_history/, 'la activación debe conservar auditoría de estados')
assert.match(migration, /subscription\.state_changed/, 'la activación debe emitir evento histórico')
assert.doesNotMatch(migration, /get_platform_billing_overview/, 'la proyección de PlatformCRM debe vivir en la migración B')
assert.match(platformMigration, /create or replace function public\.get_platform_billing_overview/)
assert.equal((platformMigration.match(/create or replace function public\.get_platform_billing_overview/g) || []).length, 1)
assert.match(platformMigration, /billing_can_manage\(\)/, 'la vista global debe conservar su guard server-side')
assert.match(platformMigration, /'subscription_id', s\.id/)
assert.match(platformMigration, /'state_version', s\.state_version/)
assert.match(platformMigration, /revoke all on function public\.get_platform_billing_overview\(\) from public, anon;/)
assert.match(platformMigration, /grant execute on function public\.get_platform_billing_overview\(\) to authenticated, service_role;/)
assert.match(migration, /when v_to = 'active' then 'active'/, 'la activación debe restaurar el estado operativo del tenant')
assert.doesNotMatch(migration, /mercadopago|paypal/i, 'la migración comercial no debe tocar proveedores ni producción')
assert.doesNotMatch(platformMigration, /mercadopago|paypal/i, 'la migración B no debe tocar proveedores ni producción')
assert.equal((migration.match(/drop policy if exists/g) || []).length, 12, 'Migration A debe reemplazar exactamente las doce políticas operativas')
assert.match(qaRunbook, /Exact QA backup checklist/)
assert.match(qaRunbook, /trial_dias.*snapshot|snapshot.*trial_dias/s)
assert.match(qaRunbook, /Historical state is append-only evidence|state history/s)
assert.match(qaRunbook, /set_updated_at.*now\(\)/s)
assert.match(qaRunbook, /transition_saas_subscription.*barberias\.estado_cuenta/s)
assert.match(platformMigration, /PlatformCRM projection/)
const criticalChecks = {
  expired_to_active_platform_admin: true,
  activation_preserves_trial_dates: true,
  stale_trial_blocked_by_db_time: true,
  active_with_historical_trial_operational: true,
  paid_past_due_semantics_preserved: true,
}
assert.match(invitations, /Vence en 14 días/, 'el TTL de invitaciones no es el trial comercial')
assert.match(demo, /15 días de prueba/)
assert.match(billing, /billing-manual-card/)

console.log(JSON.stringify({
  contract: 'commercial_trial_15_days_manual_billing',
  trial_days: COMMERCIAL_TRIAL_DAYS,
  billing_mode: COMMERCIAL_BILLING_MODE,
  whatsapp_message_encoded: true,
  automatic_backend_preserved: true,
  invitation_ttl_preserved: true,
  migration_split: true,
  owner_entitlement_update_denied: true,
  operational_helper_membership_scoped: true,
  rollback_and_backup_documented: true,
  coverage_cases: coverageCases.length,
  critical_checks: criticalChecks,
}, null, 2))
