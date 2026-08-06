import { useState } from 'react'
import { Lock, Mail, KeyRound, Scissors } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'

export async function logout() {
  if (isSupabaseConfigured) {
    await supabase.auth.signOut()
  }
}

export default function Login({ onSuccess }) {
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

    onSuccess()
  }

  return (
    <div className="login-shell">
      <div className="login-box fade-in">
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 22 }}>
          <div className="brand-mark"><Scissors size={20} strokeWidth={2.4} /></div>
          <div style={{ textAlign: 'left' }}>
            <div className="brand-name">Barberia Central</div>
            <div className="brand-sub">Panel de barberia</div>
          </div>
        </div>

        <form onSubmit={submit}>
          <div className="modal-field">
            <label className="modal-label"><Mail size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Email</label>
            <input className="text-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div className="modal-field">
            <label className="modal-label"><KeyRound size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Contrasena</label>
            <input className="text-input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </div>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} disabled={loading}>
            <Lock size={14} />
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}