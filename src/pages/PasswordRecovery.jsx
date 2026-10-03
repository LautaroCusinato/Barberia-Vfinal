import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, LoaderCircle, MailCheck } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { sanitizeAuthError } from '../lib/authErrors'
import { buildAuthRedirect } from '../lib/authRedirect'
import { PasswordField } from '../components/ui'
import { AuthAlert, AuthField, AuthPage } from './AuthLayout.jsx'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function PasswordRecovery() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [sentTo, setSentTo] = useState('')
  const [updated, setUpdated] = useState(false)
  const [fieldError, setFieldError] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined
    supabase.auth.getSession().then(({ data }) => setRecoveryMode(Boolean(data.session)))
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setRecoveryMode(true)
    })
    return () => listener?.subscription?.unsubscribe()
  }, [])

  const requestReset = async (event) => {
    event.preventDefault()
    if (loading) return
    setError('')
    const cleanEmail = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(cleanEmail)) { setFieldError({ email: 'Ingresá el email de tu cuenta.' }); return }
    setFieldError({})
    if (!isSupabaseConfigured) { setError('La recuperación no está disponible en este momento. Intentá más tarde.'); return }
    setLoading(true)
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo: buildAuthRedirect('/auth/confirm?next=/recuperar') })
      if (resetError) { setError(sanitizeAuthError(resetError, 'No pudimos enviar el enlace. Intentá nuevamente.')); return }
      setSentTo(cleanEmail)
    } catch {
      setError('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  const savePassword = async (event) => {
    event.preventDefault()
    if (loading) return
    setError('')
    const nextErrors = {}
    if (password.length < 8) nextErrors.password = 'La contraseña debe tener al menos 8 caracteres.'
    else if (password !== confirmation) nextErrors.confirmation = 'Las contraseñas no coinciden.'
    setFieldError(nextErrors)
    if (Object.keys(nextErrors).length) return
    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) { setError(sanitizeAuthError(updateError, 'No pudimos actualizar la contraseña. Intentá nuevamente.')); return }
      setPassword('')
      setConfirmation('')
      setUpdated(true)
    } catch {
      setError('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  if (updated) {
    return (
      <AuthPage cardClassName="auth-center">
        <div className="auth-icon-badge is-success"><CheckCircle2 size={24} aria-hidden="true" /></div>
        <p className="auth-kicker">Acceso seguro</p>
        <h1 className="auth-title">Contraseña actualizada</h1>
        <p className="auth-copy">Ya podés usar tu contraseña nueva para entrar al panel.</p>
        <div className="auth-actions"><button type="button" className="btn btn-primary auth-full-button" onClick={() => window.location.assign('/')}>Ir al panel <ArrowRight size={15} aria-hidden="true" /></button></div>
      </AuthPage>
    )
  }

  if (sentTo) {
    return (
      <AuthPage cardClassName="auth-center">
        <div className="auth-icon-badge is-success"><MailCheck size={24} aria-hidden="true" /></div>
        <p className="auth-kicker">Revisá tu email</p>
        <h1 className="auth-title">Te enviamos un enlace</h1>
        <p className="auth-copy" role="status">Si <strong>{sentTo}</strong> tiene una cuenta, vas a recibir un enlace para elegir una contraseña nueva. Puede tardar unos minutos.</p>
        <p className="auth-field-hint">¿No llegó? Revisá la carpeta de spam o promociones.</p>
        <div className="auth-actions">
          <button type="button" className="btn btn-primary auth-full-button" onClick={() => window.location.assign('/ingresar')}>Volver a ingresar</button>
          <button type="button" className="auth-link auth-center-link" onClick={() => setSentTo('')}>Usar otro email</button>
        </div>
      </AuthPage>
    )
  }

  return (
    <AuthPage>
      <a className="auth-back" href="/ingresar"><ArrowLeft size={15} aria-hidden="true" /> Volver a ingresar</a>
      <div className="auth-icon-badge"><KeyRound size={22} aria-hidden="true" /></div>
      <p className="auth-kicker">Acceso seguro</p>
      <h1 className="auth-title">{recoveryMode ? 'Elegí una contraseña nueva' : 'Recuperar contraseña'}</h1>
      <p className="auth-copy">{recoveryMode ? 'Usá al menos 8 caracteres. Te recomendamos que no la uses en otros sitios.' : 'Ingresá el email de tu cuenta y te enviamos un enlace de un solo uso para elegir una contraseña nueva.'}</p>
      {recoveryMode ? (
        <form className="auth-form" onSubmit={savePassword} noValidate>
          <AuthField label="Nueva contraseña" id="recovery-password" hint="Mínimo 8 caracteres." error={fieldError.password}>
            {(field) => <PasswordField {...field} className="text-input" value={password} onChange={(event) => { setPassword(event.target.value); setFieldError({}) }} minLength={8} autoComplete="new-password" autoFocus required />}
          </AuthField>
          <AuthField label="Repetir contraseña" id="recovery-confirm" error={fieldError.confirmation}>
            {(field) => <PasswordField {...field} className="text-input" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setFieldError({}) }} minLength={8} autoComplete="new-password" required />}
          </AuthField>
          <AuthAlert>{error}</AuthAlert>
          <button className="btn btn-primary auth-full-button" type="submit" disabled={loading} aria-busy={loading}>{loading ? <><LoaderCircle className="spin" size={15} aria-hidden="true" /> Guardando…</> : 'Actualizar contraseña'}</button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={requestReset} noValidate>
          <AuthField label="Email" id="recovery-email" error={fieldError.email}>
            {(field) => <input {...field} className="text-input" type="email" inputMode="email" value={email} onChange={(event) => { setEmail(event.target.value); setFieldError({}) }} autoComplete="email" autoCapitalize="none" spellCheck={false} autoFocus required placeholder="nombre@email.com" />}
          </AuthField>
          <AuthAlert>{error}</AuthAlert>
          <button className="btn btn-primary auth-full-button" type="submit" disabled={loading} aria-busy={loading}>{loading ? <><LoaderCircle className="spin" size={15} aria-hidden="true" /> Enviando…</> : 'Enviar enlace'}</button>
        </form>
      )}
    </AuthPage>
  )
}
