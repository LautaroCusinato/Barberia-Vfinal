import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, LoaderCircle, Mail, ShieldCheck } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { sanitizeAuthError } from '../lib/authErrors'
import { buildAuthRedirect } from '../lib/authRedirect'
import { PasswordField } from '../components/ui'
import { AuthAlert, AuthField, AuthPage } from './AuthLayout.jsx'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function AccountSecurity() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(isSupabaseConfigured)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [emailState, setEmailState] = useState({ loading: false, error: '', message: '' })
  const [passwordState, setPasswordState] = useState({ loading: false, error: '', message: '', field: {} })

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined
    let active = true
    supabase.auth.getUser()
      .then(({ data }) => { if (active) setUser(data.user || null) })
      .catch(() => { if (active) setUser(null) })
      .finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [])

  const updateEmail = async (event) => {
    event.preventDefault()
    if (emailState.loading) return
    const email = newEmail.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(email)) { setEmailState({ loading: false, error: 'Ingresá un email válido.', message: '' }); return }
    if (email === user?.email?.toLowerCase()) { setEmailState({ loading: false, error: 'Ese ya es el email de tu cuenta.', message: '' }); return }
    setEmailState({ loading: true, error: '', message: '' })
    try {
      const { error: updateError } = await supabase.auth.updateUser({ email }, { emailRedirectTo: buildAuthRedirect('/auth/confirm?next=/cuenta') })
      if (updateError) { setEmailState({ loading: false, error: sanitizeAuthError(updateError, 'No pudimos solicitar el cambio de email.'), message: '' }); return }
      setNewEmail('')
      setEmailState({ loading: false, error: '', message: `Te enviamos enlaces de confirmación a ${user.email} y a ${email}. El cambio se aplica cuando confirmes desde ambos.` })
    } catch {
      setEmailState({ loading: false, error: 'No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.', message: '' })
    }
  }

  const updatePassword = async (event) => {
    event.preventDefault()
    if (passwordState.loading) return
    const field = {}
    if (newPassword.length < 8) field.password = 'La nueva contraseña debe tener al menos 8 caracteres.'
    else if (newPassword !== confirmation) field.confirmation = 'Las contraseñas no coinciden.'
    if (Object.keys(field).length) { setPasswordState({ loading: false, error: '', message: '', field }); return }
    setPasswordState({ loading: true, error: '', message: '', field: {} })
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) { setPasswordState({ loading: false, error: sanitizeAuthError(updateError, 'No pudimos cambiar la contraseña.'), message: '', field: {} }); return }
      setNewPassword('')
      setConfirmation('')
      setPasswordState({ loading: false, error: '', message: 'Contraseña actualizada correctamente.', field: {} })
    } catch {
      setPasswordState({ loading: false, error: 'No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.', message: '', field: {} })
    }
  }

  if (checking) {
    return <AuthPage cardProps={{ role: 'status', 'aria-live': 'polite' }}><div className="auth-loading"><LoaderCircle className="spin" size={24} aria-hidden="true" /><p className="auth-copy">Cargando tu cuenta…</p></div></AuthPage>
  }

  if (!user) {
    return (
      <AuthPage cardClassName="auth-center">
        <div className="auth-icon-badge"><ShieldCheck size={23} aria-hidden="true" /></div>
        <p className="auth-kicker">Mi cuenta</p>
        <h1 className="auth-title">Iniciá sesión para continuar</h1>
        <p className="auth-copy">Necesitás iniciar sesión para administrar tu email y tu contraseña.</p>
        <div className="auth-actions"><a className="btn btn-primary auth-full-button" href="/ingresar?redirect=%2Fcuenta">Ir a iniciar sesión <ArrowRight size={15} aria-hidden="true" /></a></div>
      </AuthPage>
    )
  }

  return (
    <AuthPage wide>
      <a className="auth-back" href="/"><ArrowLeft size={15} aria-hidden="true" /> Volver al panel</a>
      <div className="auth-security-heading"><div className="auth-icon-badge"><ShieldCheck size={23} aria-hidden="true" /></div><div><p className="auth-kicker">Seguridad</p><h1 className="auth-title">Mi cuenta</h1></div></div>
      <p className="auth-account-row">Cuenta actual: <strong>{user.email}</strong></p>
      <div className="security-grid">
        <form className="security-panel" onSubmit={updateEmail} noValidate aria-labelledby="security-email-title">
          <h2 id="security-email-title"><Mail size={16} aria-hidden="true" /> Cambiar email</h2>
          <p>Por seguridad, vas a tener que confirmar el cambio desde los dos correos.</p>
          <AuthField label="Nuevo email" id="security-email" error={emailState.error}>
            {(field) => <input {...field} className="text-input" type="email" inputMode="email" value={newEmail} onChange={(event) => { setNewEmail(event.target.value); setEmailState((current) => ({ ...current, error: '' })) }} placeholder="nuevo@email.com" autoComplete="email" autoCapitalize="none" spellCheck={false} />}
          </AuthField>
          {emailState.message && <AuthAlert tone="success"><CheckCircle2 size={15} aria-hidden="true" /> {emailState.message}</AuthAlert>}
          <button className="btn btn-primary" type="submit" disabled={emailState.loading || !newEmail.trim()} aria-busy={emailState.loading}>{emailState.loading ? <><LoaderCircle className="spin" size={15} aria-hidden="true" /> Enviando…</> : 'Solicitar cambio'}</button>
        </form>
        <form className="security-panel" onSubmit={updatePassword} noValidate aria-labelledby="security-password-title">
          <h2 id="security-password-title"><KeyRound size={16} aria-hidden="true" /> Cambiar contraseña</h2>
          <p>Usá una contraseña única de al menos 8 caracteres.</p>
          <AuthField label="Nueva contraseña" id="security-password" error={passwordState.field.password}>
            {(field) => <PasswordField {...field} className="text-input" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordState((current) => ({ ...current, field: {}, error: '' })) }} autoComplete="new-password" minLength={8} />}
          </AuthField>
          <AuthField label="Repetir contraseña" id="security-password-confirm" error={passwordState.field.confirmation}>
            {(field) => <PasswordField {...field} className="text-input" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setPasswordState((current) => ({ ...current, field: {}, error: '' })) }} autoComplete="new-password" minLength={8} />}
          </AuthField>
          <AuthAlert>{passwordState.error}</AuthAlert>
          {passwordState.message && <AuthAlert tone="success"><CheckCircle2 size={15} aria-hidden="true" /> {passwordState.message}</AuthAlert>}
          <button className="btn btn-primary" type="submit" disabled={passwordState.loading || !newPassword} aria-busy={passwordState.loading}>{passwordState.loading ? <><LoaderCircle className="spin" size={15} aria-hidden="true" /> Guardando…</> : 'Actualizar contraseña'}</button>
        </form>
      </div>
    </AuthPage>
  )
}
