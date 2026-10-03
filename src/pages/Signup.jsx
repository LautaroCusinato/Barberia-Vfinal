import { useState } from 'react'
import { ArrowRight, CheckCircle2, LoaderCircle, MailCheck } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { sanitizeAuthError } from '../lib/authErrors'
import { buildAuthRedirect, safeAuthNext } from '../lib/authRedirect'
import { COMMERCIAL_TRIAL_DAYS } from '../lib/commercialCatalog'
import { PasswordField } from '../components/ui'
import { AuthAlert, AuthField, AuthPage } from './AuthLayout.jsx'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function go(path) {
  window.location.assign(path)
}

// Una invitación de equipo puede mandar a registrarse con ?redirect=/invitacion/…
// para volver a aceptarla después de confirmar el email.
function signupNext() {
  return safeAuthNext(new URLSearchParams(window.location.search).get('redirect'), '/onboarding')
}

function validate({ name, email, password, confirmation }) {
  const errors = {}
  const cleanName = name.trim()
  if (cleanName.length < 2 || cleanName.length > 80) errors.name = 'Escribí tu nombre (entre 2 y 80 caracteres).'
  if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Ingresá un email válido, por ejemplo nombre@gmail.com.'
  if (password.length < 8) errors.password = 'La contraseña debe tener al menos 8 caracteres.'
  if (!errors.password && password !== confirmation) errors.confirmation = 'Las contraseñas no coinciden.'
  return errors
}

export default function Signup() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState('')
  const next = signupNext()
  const loginHref = next === '/onboarding' ? '/ingresar' : `/ingresar?redirect=${encodeURIComponent(next)}`

  const clearFieldError = (key) => setErrors((current) => (current[key] ? { ...current, [key]: '' } : current))

  const submit = async (event) => {
    event.preventDefault()
    if (loading) return
    setError('')
    const nextErrors = validate({ name, email, password, confirmation })
    if (Object.values(nextErrors).some(Boolean)) {
      setErrors(nextErrors)
      const firstInvalid = ['name', 'email', 'password', 'confirmation'].find((key) => nextErrors[key])
      document.getElementById(`signup-${firstInvalid === 'confirmation' ? 'confirm' : firstInvalid}`)?.focus()
      return
    }
    setErrors({})
    if (!isSupabaseConfigured) { setError('El registro no está disponible en este momento. Intentá más tarde.'); return }

    const cleanEmail = email.trim().toLowerCase()
    setLoading(true)
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { full_name: name.trim() },
          emailRedirectTo: buildAuthRedirect(next === '/onboarding' ? '/auth/confirm?next=/onboarding' : `/auth/confirm?next=${encodeURIComponent(next)}`),
        },
      })
      if (signUpError) {
        if (signUpError.message?.toLowerCase().includes('already')) setError('Ese email ya está registrado. Probá iniciar sesión o recuperar la contraseña.')
        else setError(sanitizeAuthError(signUpError, 'No pudimos crear tu cuenta. Intentá nuevamente.'))
        return
      }
      if (data.session) { go(next); return }
      setCreated(cleanEmail)
    } catch {
      setError('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  if (created) {
    return (
      <AuthPage cardClassName="auth-center">
        <div className="auth-icon-badge is-success"><MailCheck size={24} aria-hidden="true" /></div>
        <p className="auth-kicker">Cuenta creada</p>
        <h1 className="auth-title">Revisá tu email</h1>
        <p className="auth-copy">Te enviamos un enlace de verificación a <strong>{created}</strong>. Cuando lo confirmes, vas a poder crear tu negocio y empezar tu prueba gratuita de {COMMERCIAL_TRIAL_DAYS} días.</p>
        <p className="auth-field-hint">¿No llegó? Revisá la carpeta de spam o promociones.</p>
        <div className="auth-actions">
          <button type="button" className="btn btn-primary auth-full-button" onClick={() => go(loginHref)}>Ir a iniciar sesión <ArrowRight size={15} aria-hidden="true" /></button>
        </div>
      </AuthPage>
    )
  }

  const passwordsMatch = confirmation.length >= 8 && password === confirmation

  return (
    <AuthPage headerAction={<a className="auth-header-link" href={loginHref}>Ingresar</a>}>
      <p className="auth-kicker">Empezá gratis</p>
      <h1 className="auth-title">Creá tu cuenta</h1>
      <p className="auth-copy">{COMMERCIAL_TRIAL_DAYS} días de prueba, sin tarjeta. Los datos del negocio los cargás en el siguiente paso.</p>

      <form onSubmit={submit} className="auth-form" noValidate>
        <AuthField label="Nombre" id="signup-name" error={errors.name}>
          {(field) => <input {...field} className="text-input" value={name} onChange={(event) => { setName(event.target.value); clearFieldError('name') }} autoComplete="name" autoCapitalize="words" autoFocus required maxLength={80} placeholder="Tu nombre y apellido" />}
        </AuthField>
        <AuthField label="Email" id="signup-email" error={errors.email}>
          {(field) => <input {...field} className="text-input" type="email" inputMode="email" value={email} onChange={(event) => { setEmail(event.target.value); clearFieldError('email') }} autoComplete="email" autoCapitalize="none" spellCheck={false} required placeholder="nombre@email.com" />}
        </AuthField>
        <AuthField label="Contraseña" id="signup-password" hint="Mínimo 8 caracteres." error={errors.password}>
          {(field) => <PasswordField {...field} className="text-input" value={password} onChange={(event) => { setPassword(event.target.value); clearFieldError('password'); clearFieldError('confirmation') }} autoComplete="new-password" minLength={8} required />}
        </AuthField>
        <AuthField label="Repetir contraseña" id="signup-confirm" error={errors.confirmation}>
          {(field) => <PasswordField {...field} className="text-input" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); clearFieldError('confirmation') }} autoComplete="new-password" minLength={8} required />}
        </AuthField>
        {passwordsMatch && !errors.confirmation && <span className="auth-field-ok" aria-live="polite"><CheckCircle2 size={14} aria-hidden="true" /> Las contraseñas coinciden.</span>}
        <AuthAlert>{error}</AuthAlert>
        <button type="submit" className="btn btn-primary auth-full-button" disabled={loading} aria-busy={loading}>
          {loading ? <><LoaderCircle className="spin" size={15} aria-hidden="true" /> Creando cuenta…</> : <>Crear cuenta <ArrowRight size={15} aria-hidden="true" /></>}
        </button>
      </form>
      <p className="auth-footer-copy">¿Ya tenés una cuenta? <a className="auth-link" href={loginHref}>Iniciar sesión</a></p>
    </AuthPage>
  )
}
