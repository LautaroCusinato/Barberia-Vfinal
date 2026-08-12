import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, LoaderCircle, Mail, ShieldCheck } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { authErrorKind, sanitizeAuthError } from '../lib/authErrors'
import { buildAuthRedirect, safeAuthNext } from '../lib/authRedirect'

function clearAuthParams() {
  try {
    window.history.replaceState({}, document.title, `${window.location.pathname}`)
  } catch {
    // History API is optional in embedded browsers.
  }
}

function getCallbackData() {
  const url = new URL(window.location.href)
  const query = url.searchParams
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  return {
    code: query.get('code'),
    queryError: query.get('error') || query.get('error_code') || query.get('error_description'),
    accessToken: hash.get('access_token'),
    refreshToken: hash.get('refresh_token'),
    type: hash.get('type') || query.get('type') || '',
    next: safeAuthNext(query.get('next'), '/onboarding'),
  }
}

function statusCopy(status, recovery) {
  if (status === 'success' && recovery) return { title: 'Enlace verificado', copy: 'Tu sesión de recuperación está lista para elegir una contraseña nueva.', action: 'Elegir contraseña' }
  if (status === 'success') return { title: 'Email confirmado correctamente', copy: 'Tu cuenta ya está lista.', action: 'Continuar' }
  if (status === 'already') return { title: 'Tu email ya estaba confirmado', copy: 'Podés ingresar y continuar con tu cuenta.', action: 'Ingresar' }
  if (status === 'invalid') return { title: 'Este enlace ya no es válido', copy: 'Podés solicitar un nuevo email de confirmación para continuar.', action: 'Enviar un nuevo enlace' }
  return { title: 'Confirmación de email', copy: 'Estamos verificando tu enlace de forma segura.', action: '' }
}

export default function AuthConfirm() {
  const [status, setStatus] = useState('loading')
  const [recovery, setRecovery] = useState(false)
  const [next, setNext] = useState('/onboarding')
  const [email, setEmail] = useState('')
  const [resendState, setResendState] = useState('idle')
  const [resendError, setResendError] = useState('')

  const copy = useMemo(() => statusCopy(status, recovery), [status, recovery])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setStatus('invalid')
      return undefined
    }

    let active = true
    const callback = getCallbackData()
    setNext(callback.next)

    async function complete() {
      if (callback.queryError) {
        if (active) setStatus(authErrorKind({ code: callback.queryError, message: callback.queryError }) === 'already_confirmed' ? 'already' : 'invalid')
        clearAuthParams()
        return
      }

      const hasCallbackToken = Boolean(callback.code || (callback.accessToken && callback.refreshToken))
      let result
      if (callback.code) {
        result = await supabase.auth.exchangeCodeForSession(callback.code)
      } else if (callback.accessToken && callback.refreshToken) {
        result = await supabase.auth.setSession({ access_token: callback.accessToken, refresh_token: callback.refreshToken })
      } else {
        result = await supabase.auth.getSession()
      }

      if (!active) return
      const session = result?.data?.session || null
      const error = result?.error || null
      if (error) {
        setStatus(authErrorKind(error) === 'already_confirmed' ? 'already' : 'invalid')
        clearAuthParams()
        return
      }

      const user = session?.user || null
      if (callback.type === 'recovery') {
        setRecovery(true)
        setStatus(session ? 'success' : 'invalid')
      } else if (user?.email_confirmed_at && hasCallbackToken) {
        setEmail(user.email || '')
        setStatus('success')
      } else if (user?.email_confirmed_at) {
        setEmail(user.email || '')
        setStatus('already')
      } else if (user) {
        setEmail(user.email || '')
        setStatus('already')
      } else {
        setStatus('invalid')
      }
      clearAuthParams()
    }

    complete().catch(() => { if (active) setStatus('invalid') })
    return () => { active = false }
  }, [])

  const continueTo = () => window.location.assign(recovery ? '/recuperar' : status === 'already' ? '/ingresar' : next)

  const resend = async (event) => {
    event.preventDefault()
    if (!email.trim() || resendState === 'loading') return
    setResendState('loading')
    setResendError('')
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: buildAuthRedirect('/auth/confirm?next=/onboarding') },
    })
    if (error) {
      setResendState('error')
      setResendError(sanitizeAuthError(error, 'No pudimos enviar un nuevo enlace.'))
      return
    }
    setResendState('sent')
  }

  return (
    <div className="auth-shell">
      <div className="auth-card fade-in" role="status" aria-live="polite">
        <div className="auth-success-icon">{status === 'loading' ? <LoaderCircle className="spin" size={23} /> : status === 'success' || status === 'already' ? <CheckCircle2 size={23} /> : <ShieldCheck size={23} />}</div>
        <p className="auth-kicker">Austral Automatizaciones</p>
        <h1 className="auth-title">{copy.title}</h1>
        <p className="auth-copy">{copy.copy}</p>
        {status === 'invalid' && (
          <form className="auth-form" onSubmit={resend}>
            <div className="modal-field"><label className="modal-label" htmlFor="confirm-email"><Mail size={13} /> Email</label><input id="confirm-email" className="text-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></div>
            {resendError && <p className="login-error" role="alert">{resendError}</p>}
            {resendState === 'sent' && <p className="auth-message"><CheckCircle2 size={15} /> Te enviamos un nuevo enlace. Revisá tu email.</p>}
            <button className="btn btn-primary auth-full-button" type="submit" disabled={resendState === 'loading'}>{resendState === 'loading' ? 'Enviando…' : 'Enviar un nuevo enlace'} <ArrowRight size={15} /></button>
          </form>
        )}
        {status === 'success' || status === 'already' ? <button className="btn btn-primary auth-full-button" type="button" onClick={continueTo}>{copy.action} <ArrowRight size={15} /></button> : null}
        {status === 'invalid' && <button className="auth-link auth-center-link" type="button" onClick={() => window.location.assign('/ingresar')}>Volver a ingresar</button>}
      </div>
    </div>
  )
}
