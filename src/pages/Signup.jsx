import { useState } from 'react'
import { ArrowRight, CheckCircle2, KeyRound, Mail, Scissors, UserRound } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { DEFAULT_BUSINESS_NAME, PRODUCT_NAME } from '../lib/tenant'
import { PasswordField } from '../components/ui'

function go(path) {
  window.location.assign(path)
}

export default function Signup() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const cleanName = name.trim()
    const cleanEmail = email.trim().toLowerCase()
    if (cleanName.length < 2 || cleanName.length > 80) return setError('Escribí tu nombre (entre 2 y 80 caracteres).')
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.')
    if (password !== confirmation) return setError('Las contraseñas no coinciden.')
    if (!isSupabaseConfigured) return setError('El registro no está disponible porque falta configurar Supabase.')

    setLoading(true)
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: { full_name: cleanName },
        emailRedirectTo: `${window.location.origin}/onboarding`,
      },
    })
    setLoading(false)

    if (signUpError) {
      if (signUpError.message?.toLowerCase().includes('already')) setError('Ese email ya está registrado. Probá iniciar sesión o recuperar la contraseña.')
      else setError(signUpError.message || 'No pudimos crear tu cuenta.')
      return
    }
    if (data.session) {
      go('/onboarding')
      return
    }
    setCreated(true)
  }

  if (created) {
    return (
      <div className="auth-shell">
        <div className="auth-card fade-in auth-success-card">
          <div className="auth-success-icon"><CheckCircle2 size={24} /></div>
          <p className="auth-kicker">Cuenta creada</p>
          <h1 className="auth-title">Revisá tu email</h1>
          <p className="auth-copy">Te enviamos un enlace de verificación. Cuando lo confirmes, vas a poder crear tu negocio y empezar tu prueba gratuita de 14 días.</p>
          <button className="btn btn-primary auth-full-button" onClick={() => go('/')}>
            Ir a iniciar sesión <ArrowRight size={15} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-shell">
      <div className="auth-card fade-in">
        <div className="auth-brand">
          <div className="brand-mark"><Scissors size={19} strokeWidth={2.4} /></div>
          <div>
            <div className="brand-name">{PRODUCT_NAME}</div>
            <div className="brand-sub">para {DEFAULT_BUSINESS_NAME}</div>
          </div>
        </div>
        <p className="auth-kicker">Empezá gratis</p>
        <h1 className="auth-title">Creá tu cuenta</h1>
        <p className="auth-copy">Configurá tu negocio en pocos minutos. No te pedimos datos del negocio hasta el siguiente paso.</p>

        <form onSubmit={submit} className="auth-form">
          <div className="modal-field">
            <label className="modal-label" htmlFor="signup-name"><UserRound size={13} /> Nombre</label>
            <input id="signup-name" className="text-input" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" autoFocus required maxLength={80} />
          </div>
          <div className="modal-field">
            <label className="modal-label" htmlFor="signup-email"><Mail size={13} /> Email</label>
            <input id="signup-email" className="text-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </div>
          <div className="modal-field">
            <label className="modal-label" htmlFor="signup-password"><KeyRound size={13} /> Contraseña</label>
            <PasswordField id="signup-password" className="text-input" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required />
            <span className="field-hint">Mínimo 8 caracteres.</span>
          </div>
          <div className="modal-field">
            <label className="modal-label" htmlFor="signup-confirm"><KeyRound size={13} /> Repetir contraseña</label>
            <PasswordField id="signup-confirm" className="text-input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={8} required />
          </div>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary auth-full-button" disabled={loading}>
            {loading ? 'Creando cuenta…' : 'Crear cuenta'} <ArrowRight size={15} />
          </button>
        </form>
        <p className="auth-footer-copy">¿Ya tenés una cuenta? <button className="auth-link" onClick={() => go('/')}>Iniciar sesión</button></p>
      </div>
    </div>
  )
}
