import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, KeyRound, Mail } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { sanitizeAuthError } from '../lib/authErrors'
import { buildAuthRedirect } from '../lib/authRedirect'

export default function PasswordRecovery() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [message, setMessage] = useState('')
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
    event.preventDefault(); setError(''); setMessage('')
    if (!email.trim()) return setError('Ingresá el email de tu cuenta.')
    setLoading(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: buildAuthRedirect('/auth/confirm?next=/recuperar') })
    setLoading(false)
    if (resetError) return setError(sanitizeAuthError(resetError, 'No pudimos enviar el enlace.'))
    setMessage('Revisá tu email. El enlace te va a traer de vuelta para elegir una contraseña nueva.')
  }

  const savePassword = async (event) => {
    event.preventDefault(); setError(''); setMessage('')
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.')
    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (updateError) return setError(sanitizeAuthError(updateError, 'No pudimos actualizar la contraseña.'))
    setMessage('Contraseña actualizada. Ya podés entrar al panel.')
    setPassword('')
  }

  return (
    <main className="auth-shell">
      <div className="auth-card fade-in">
        <button className="auth-back" onClick={() => window.location.assign('/')}><ArrowLeft size={15} /> Volver</button>
        <div className="auth-success-icon"><KeyRound size={22} /></div>
        <p className="auth-kicker">Acceso seguro</p>
        <h1 className="auth-title">{recoveryMode ? 'Elegí una contraseña nueva' : 'Recuperar contraseña'}</h1>
        <p className="auth-copy">{recoveryMode ? 'La contraseña se actualiza de forma segura en Supabase.' : 'Te enviaremos un enlace de un solo uso para recuperar tu cuenta.'}</p>
        {message && <p className="auth-message" role="status" aria-live="polite"><CheckCircle2 size={15} /> {message}</p>}
        {error && <p className="login-error" role="alert">{error}</p>}
        {recoveryMode ? (
          <form className="auth-form" onSubmit={savePassword}>
            <div className="modal-field"><label className="modal-label" htmlFor="recovery-password"><KeyRound size={13} /> Nueva contraseña</label><input id="recovery-password" className="text-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} autoComplete="new-password" autoFocus required /></div>
            <button className="btn btn-primary auth-full-button" type="submit" disabled={loading}>{loading ? 'Guardando…' : 'Actualizar contraseña'}</button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={requestReset}>
            <div className="modal-field"><label className="modal-label" htmlFor="recovery-email"><Mail size={13} /> Email</label><input id="recovery-email" className="text-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" autoFocus required /></div>
            <button className="btn btn-primary auth-full-button" type="submit" disabled={loading}>{loading ? 'Enviando…' : 'Enviar enlace'}</button>
          </form>
        )}
      </div>
    </main>
  )
}
