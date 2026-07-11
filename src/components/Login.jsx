import { useState } from 'react'
import { Lock, User, KeyRound, Scissors } from 'lucide-react'

const ADMIN_USER = import.meta.env.VITE_ADMIN_USER || 'admin'
const ADMIN_PASS = import.meta.env.VITE_ADMIN_PASS || 'barberia2026'
const AUTH_KEY = 'barberia-central-auth'

export function isAuthenticated() {
  return localStorage.getItem(AUTH_KEY) === 'true'
}

export function logout() {
  localStorage.removeItem(AUTH_KEY)
  window.location.reload()
}

export default function Login({ onSuccess }) {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')

  const submit = (e) => {
    e.preventDefault()
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
      localStorage.setItem(AUTH_KEY, 'true')
      onSuccess()
    } else {
      setError('Usuario o contrasena incorrectos')
    }
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
            <label className="modal-label"><User size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Usuario</label>
            <input className="text-input" value={user} onChange={(e) => setUser(e.target.value)} autoFocus />
          </div>
          <div className="modal-field">
            <label className="modal-label"><KeyRound size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Contrasena</label>
            <input className="text-input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </div>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}>
            <Lock size={14} />
            Entrar
          </button>
        </form>
      </div>
    </div>
  )
}
