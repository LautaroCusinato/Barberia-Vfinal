import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260807000000_self_service_onboarding.sql'), 'utf8')
const observability = fs.readFileSync(path.join(root, 'supabase/migrations/20260807010000_onboarding_observability.sql'), 'utf8')
const main = fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8')
const signup = fs.readFileSync(path.join(root, 'src/pages/Signup.jsx'), 'utf8')
const wizard = fs.readFileSync(path.join(root, 'src/pages/OnboardingWizard.jsx'), 'utf8')
const checklist = fs.readFileSync(path.join(root, 'src/components/OnboardingChecklist.jsx'), 'utf8')

const required = [
  'saas_verticales', 'saas_onboarding_sessions', 'saas_onboarding_events', 'saas_audit_log',
  'get_self_service_catalog', 'track_self_service_onboarding', 'complete_self_service_onboarding',
  'get_onboarding_status', 'email_confirmed_at', 'pg_advisory_xact_lock', 'saas_suscripciones',
  'crm_negocios', 'crm_leads', 'horarios_default', 'reservas_config',
]
for (const token of required) {
  if (!migration.includes(token)) throw new Error(`Falta ${token} en la migración de onboarding`)
}

if (!migration.includes('grant execute on function public.complete_self_service_onboarding')) throw new Error('La RPC de onboarding no tiene grant explícito')
if (!observability.includes('registered_at') || !observability.includes('onboarding_abandoned')) throw new Error('Falta observabilidad de registro/abandono')
if (migration.includes('insert into public.barberos') || migration.includes('insert into public.clientes')) throw new Error('El onboarding no debe crear empleados ni clientes ficticios')
if (!main.includes("path === '/registro'") || !main.includes("path === '/onboarding'") || !main.includes("path === '/recuperar'")) throw new Error('Faltan rutas públicas del onboarding')
if (!signup.includes('supabase.auth.signUp') || !signup.includes('emailRedirectTo')) throw new Error('El registro no usa verificación de email')
if (!wizard.includes('localStorage') || !wizard.includes("complete_self_service_onboarding")) throw new Error('El asistente no tiene autoguardado o finalización server-side')
if (!checklist.includes("get_onboarding_status")) throw new Error('El checklist no usa el estado server-side')

console.log('Self-service onboarding checks passed')
