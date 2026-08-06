import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, KeyRound, Mail, ShieldCheck } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'

export default function AccountSecurity() {
  const [user, setUser] = useState(null)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase.auth.getUser().then(({ data }) => setUser(data.user || null))
  }, [])

  const updateEmail = async (event) => {
    event.preventDefault()
    setMessage('')
    setError('')
    const email = newEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) return setError('Ingresá un email válido.')
    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ email })
    setLoading(false)
    if (updateError) return setError(updateError.message || 'No pudimos solicitar el cambio de email.')
    setNewEmail('')
    setMessage('Te enviamos enlaces de confirmación al email actual y al nuevo.')
  }

  const updatePassword = async (event) => {
    event.preventDefault()
    setMessage('')
    setError('')
    if (newPassword.length < 8) return setError('La nueva contraseña debe tener al menos 8 caracteres.')
    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setLoading(false)
    if (updateError) return setError(updateError.message || 'No pudimos cambiar la contraseña.')
    setNewPassword('')
    setMessage('Contraseña actualizada correctamente.')
  }

  if (!user) {
    return <div className="auth-shell"><div className="auth-card"><p className="auth-copy">Necesitás iniciar sesión para administrar tu cuenta.</p><button className="btn btn-primary auth-full-button" onClick={() => window.location.assign('/')}>Ir a iniciar sesión</button></div></div>
  }

  return (
    <div className="auth-shell">
      <div className="auth-card auth-card-wide fade-in">
        <button className="auth-back" onClick={() => window.location.assign('/')}><ArrowLeft size={15} /> Volver al panel</button>
        <div className="auth-security-heading"><div className="auth-success-icon"><ShieldCheck size={23} /></div><div><p className="auth-kicker">Seguridad</p><h1 className="auth-title">Mi cuenta</h1></div></div>
        <p className="auth-copy">Cuenta actual: <strong>{user.email}</strong></p>
        {message && <p className="auth-message"><CheckCircle2 size={15} /> {message}</p>}
        {error && <p className="login-error" role="alert">{error}</p>}
        <div className="security-grid">
          <form className="security-panel" onSubmit={updateEmail}>
            <h2><Mail size={16} /> Cambiar email</h2>
            <p>Por seguridad, tendrás que confirmar el cambio desde ambos buzones.</p>
            <input className="text-input" type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="nuevo@email.com" autoComplete="email" />
            <button className="btn" type="submit" disabled={loading}>Solicitar cambio</button>
          </form>
          <form className="security-panel" onSubmit={updatePassword}>
            <h2><KeyRound size={16} /> Cambiar contraseña</h2>
            <p>Usá una contraseña única de al menos 8 caracteres.</p>
            <input className="text-input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Nueva contraseña" autoComplete="new-password" minLength={8} />
            <button className="btn" type="submit" disabled={loading}>Actualizar contraseña</button>
          </form>
        </div>
      </div>
    </div>
  )
}
