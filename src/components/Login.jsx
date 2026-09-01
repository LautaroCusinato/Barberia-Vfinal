import { useState } from 'react'
import { Lock, Mail, KeyRound, Scissors, UserPlus, HelpCircle, LoaderCircle } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
export { logout } from '../lib/auth.js'
import { DEFAULT_BUSINESS_NAME } from '../lib/tenant'
import { safeAuthNext } from '../lib/authRedirect'
import { PasswordField } from './ui'

export default function Login({ onSuccess, businessName = DEFAULT_BUSINESS_NAME }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')

    if (!isSupabaseConfigured) {
      setError('Supabase no esta configurado (faltan variables de entorno).')
      return
    }

    setLoading(true)
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password: pass,
    })
    setLoading(false)

    if (authError) {
      setError('Email o contrasena incorrectos')
      return
    }

    const redirect = safeAuthNext(new URLSearchParams(window.location.search).get('redirect'), '/')
    onSuccess(redirect)
  }

  return (
    <main className="login-shell">
      <div className="login-box fade-in">
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 22 }}>
          <div className="brand-mark"><Scissors size={20} strokeWidth={2.4} /></div>
          <div style={{ textAlign: 'left' }}>
            <h1 className="brand-name">{businessName}</h1>
            <div className="brand-sub">Panel de gestión</div>
          </div>
        </div>

        <form onSubmit={submit}>
          <div className="modal-field">
            <label className="modal-label" htmlFor="login-email"><Mail size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Email</label>
            <input id="login-email" className="text-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
          </div>
          <div className="modal-field">
            <label className="modal-label" htmlFor="login-password"><KeyRound size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Contraseña</label>
            <PasswordField id="login-password" className="text-input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" required />
          </div>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} disabled={loading} aria-busy={loading}>
            {loading ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <div className="login-links">
          <button className="auth-link" onClick={() => window.location.assign('/recuperar')}><HelpCircle size={13} /> ¿Olvidaste tu contraseña?</button>
          <button className="btn login-signup-button" onClick={() => window.location.assign('/registro')}><UserPlus size={14} /> Crear una cuenta</button>
        </div>
      </div>
    </main>
  )
}
