import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, LoaderCircle, ShieldAlert } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { authErrorKind, sanitizeAuthError } from '../lib/authErrors'
import { buildAuthRedirect, safeAuthNext } from '../lib/authRedirect'
import { AuthAlert, AuthField, AuthPage } from './AuthLayout.jsx'

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
    tokenHash: query.get('token_hash'),
    queryError: query.get('error') || query.get('error_code') || query.get('error_description'),
    accessToken: hash.get('access_token'),
    refreshToken: hash.get('refresh_token'),
    type: hash.get('type') || query.get('type') || '',
    next: safeAuthNext(query.get('next'), '/onboarding'),
  }
}

function statusCopy(status, recovery) {
  if ((status === 'success' || status === 'already') && recovery) return { title: 'Enlace verificado', copy: 'Tu sesión de recuperación está lista para elegir una contraseña nueva.', action: 'Elegir contraseña' }
  if (status === 'success') return { title: 'Email confirmado correctamente', copy: 'Tu cuenta ya está lista.', action: 'Continuar' }
  if (status === 'already') return { title: 'Tu email ya estaba confirmado', copy: 'Podés ingresar y continuar con tu cuenta.', action: 'Ingresar' }
  if (status === 'invalid' && recovery) return { title: 'Este enlace ya no es válido', copy: 'Los enlaces de recuperación vencen o se usan una sola vez. Pedí uno nuevo desde "Recuperar contraseña".', action: '' }
  if (status === 'invalid') return { title: 'Este enlace ya no es válido', copy: 'Puede haber vencido o ya haberse usado. Pedí un nuevo email de confirmación para continuar.', action: 'Enviar un nuevo enlace' }
  return { title: 'Verificando tu enlace…', copy: 'Esto tarda solo unos segundos.', action: '' }
}

export default function AuthConfirm() {
  const [status, setStatus] = useState('loading')
  const [recovery, setRecovery] = useState(false)
  const [next, setNext] = useState('/onboarding')
  const [email, setEmail] = useState('')
  const [resendState, setResendState] = useState('idle')
  const [resendError, setResendError] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  const copy = useMemo(() => statusCopy(status, recovery), [status, recovery])

  useEffect(() => {
    if (resendCooldown <= 0) return undefined
    const timer = window.setInterval(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [resendCooldown])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setStatus('invalid')
      return undefined
    }

    let active = true
    const callback = getCallbackData()
    setNext(callback.next)
    // El email de recuperación vuelve con next=/recuperar: si el enlace falla,
    // ofrecemos pedir otro de recuperación y no un reenvío de registro.
    if (callback.type === 'recovery' || callback.next === '/recuperar') setRecovery(true)

    async function complete() {
      if (callback.queryError) {
        if (active) setStatus(authErrorKind({ code: callback.queryError, message: callback.queryError }) === 'already_confirmed' ? 'already' : 'invalid')
        clearAuthParams()
        return
      }

      const hasCallbackToken = Boolean(callback.code || callback.tokenHash || (callback.accessToken && callback.refreshToken))
      let result
      if (callback.code) {
        result = await supabase.auth.exchangeCodeForSession(callback.code)
      } else if (callback.tokenHash) {
        result = await supabase.auth.verifyOtp({ token_hash: callback.tokenHash, type: callback.type || 'email' })
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
    if (!email.trim() || resendState === 'loading' || resendCooldown > 0) return
    setResendState('loading')
    setResendError('')
    let error
    try {
      ;({ error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: buildAuthRedirect('/auth/confirm?next=/onboarding') },
      }))
    } catch (requestError) {
      error = requestError || new Error('network')
    }
    if (error) {
      setResendState('error')
      setResendError(sanitizeAuthError(error, 'No pudimos enviar un nuevo enlace.'))
      setResendCooldown(10)
      return
    }
    setResendState('sent')
    setResendCooldown(30)
  }

  const iconTone = status === 'success' || status === 'already' ? 'is-success' : status === 'invalid' ? 'is-danger' : ''

  return (
    <AuthPage cardProps={{ 'aria-live': 'polite', 'aria-busy': status === 'loading' }}>
      <div className={`auth-icon-badge ${iconTone}`}>{status === 'loading' ? <LoaderCircle className="spin" size={23} aria-hidden="true" /> : status === 'success' || status === 'already' ? <CheckCircle2 size={23} aria-hidden="true" /> : <ShieldAlert size={23} aria-hidden="true" />}</div>
      <p className="auth-kicker">{recovery ? 'Recuperar contraseña' : 'Confirmación de email'}</p>
      <h1 className="auth-title">{copy.title}</h1>
      <p className="auth-copy">{copy.copy}</p>
      {status === 'invalid' && recovery && <div className="auth-actions"><a className="btn btn-primary auth-full-button" href="/recuperar">Pedir un enlace nuevo <ArrowRight size={15} aria-hidden="true" /></a></div>}
      {status === 'invalid' && !recovery && (
        <form className="auth-form" onSubmit={resend} noValidate>
          <AuthField label="Email" id="confirm-email" hint="Usá el mismo email con el que creaste la cuenta.">
            {(field) => <input {...field} className="text-input" type="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false} required placeholder="nombre@email.com" />}
          </AuthField>
          <AuthAlert>{resendError}</AuthAlert>
          {resendState === 'sent' && <AuthAlert tone="success"><CheckCircle2 size={15} aria-hidden="true" /> Te enviamos un nuevo enlace. Revisá tu email.</AuthAlert>}
          <button className="btn btn-primary auth-full-button" type="submit" disabled={!email.trim() || resendState === 'loading' || resendCooldown > 0} aria-busy={resendState === 'loading'}>{resendState === 'loading' ? 'Enviando…' : resendCooldown > 0 ? `Podés reenviar en ${resendCooldown} s` : <>Enviar un nuevo enlace <ArrowRight size={15} aria-hidden="true" /></>}</button>
        </form>
      )}
      {status === 'success' || status === 'already' ? <div className="auth-actions"><button className="btn btn-primary auth-full-button" type="button" onClick={continueTo}>{copy.action} <ArrowRight size={15} aria-hidden="true" /></button></div> : null}
      {status === 'invalid' && <a className="auth-link auth-center-link" href="/ingresar">Volver a ingresar</a>}
    </AuthPage>
  )
}
