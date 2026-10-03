import { useEffect, useState } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
export { logout } from '../lib/auth.js'
import { DEFAULT_BUSINESS_NAME } from '../lib/tenant'
import { buildAuthRedirect, safeAuthNext } from '../lib/authRedirect'
import { authErrorKind, sanitizeAuthError } from '../lib/authErrors'
import { PasswordField } from './ui'
import { AuthAlert, AuthField, AuthPage } from '../pages/AuthLayout.jsx'

function loginErrorMessage(authError) {
  const raw = `${authError?.code || ''} ${authError?.message || ''}`.toLowerCase()
  if (/not.?confirmed/.test(raw)) return { kind: 'unconfirmed', message: 'Tu email todavía no está confirmado. Abrí el enlace que te enviamos o pedí uno nuevo.' }
  if (authErrorKind(authError) === 'rate_limit') return { kind: 'rate_limit', message: 'Hubo demasiados intentos. Esperá unos minutos y volvé a probar.' }
  return { kind: 'credentials', message: 'Email o contraseña incorrectos.' }
}

export default function Login({ onSuccess, businessName = DEFAULT_BUSINESS_NAME }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [errorKind, setErrorKind] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const redirectParam = new URLSearchParams(window.location.search).get('redirect')
  const signupHref = redirectParam ? `/registro?redirect=${encodeURIComponent(safeAuthNext(redirectParam, '/'))}` : '/registro'

  useEffect(() => {
    const previous = document.title
    document.title = `Ingresar · ${businessName}`
    return () => { document.title = previous }
  }, [businessName])

  const submit = async (e) => {
    e.preventDefault()
    if (loading) return
    setError('')
    setErrorKind('')
    setNotice('')

    if (!email.trim() || !pass) {
      setError('Completá tu email y tu contraseña.')
      return
    }
    if (!isSupabaseConfigured) {
      setError('El ingreso no está disponible en este momento. Intentá más tarde.')
      return
    }

    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: pass,
      })
      if (authError) {
        const { kind, message } = loginErrorMessage(authError)
        setErrorKind(kind)
        setError(message)
        return
      }
    } catch {
      setError('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.')
      return
    } finally {
      setLoading(false)
    }

    const redirect = safeAuthNext(redirectParam, '/')
    onSuccess(redirect)
  }

  const resendConfirmation = async () => {
    if (resending || !email.trim()) return
    setResending(true)
    const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase(), options: { emailRedirectTo: buildAuthRedirect('/auth/confirm?next=/onboarding') } })
    setResending(false)
    if (resendError) { setError(sanitizeAuthError(resendError, 'No pudimos reenviar el email. Intentá en unos minutos.')); setErrorKind('') }
    else { setError(''); setErrorKind(''); setNotice('Te enviamos un nuevo enlace de confirmación. Revisá tu email.') }
  }

  return (
    <AuthPage headerAction={<a className="auth-header-link" href={signupHref}>Crear cuenta</a>}>
      <p className="auth-kicker">Panel de gestión</p>
      <h1 className="auth-title">Ingresá a tu cuenta</h1>
      <p className="auth-copy">Gestioná turnos, clientes y reservas de tu negocio.</p>

      <form onSubmit={submit} className="auth-form" noValidate>
        <AuthField label="Email" id="login-email">
          {(field) => <input {...field} className="text-input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false} autoFocus required placeholder="nombre@email.com" />}
        </AuthField>
        <AuthField label="Contraseña" id="login-password">
          {(field) => <PasswordField {...field} className="text-input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" required />}
        </AuthField>
        <a className="auth-link auth-forgot-link" href="/recuperar">¿Olvidaste tu contraseña?</a>
        <AuthAlert>{error}</AuthAlert>
        {errorKind === 'unconfirmed' && <button type="button" className="btn auth-secondary-button" onClick={resendConfirmation} disabled={resending} aria-busy={resending}>{resending ? 'Enviando…' : 'Reenviar email de confirmación'}</button>}
        <AuthAlert tone="success">{notice}</AuthAlert>
        <button type="submit" className="btn btn-primary auth-full-button" disabled={loading} aria-busy={loading}>
          {loading ? <><LoaderCircle className="spin" size={15} aria-hidden="true" /> Entrando…</> : <>Entrar <ArrowRight size={15} aria-hidden="true" /></>}
        </button>
      </form>
      <div className="auth-divider">¿Es tu primera vez?</div>
      <a className="btn auth-secondary-button" href={signupHref}>Crear una cuenta gratis</a>
    </AuthPage>
  )
}
