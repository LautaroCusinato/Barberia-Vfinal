import { useEffect, useState } from 'react'
import { CheckCircle2, LoaderCircle, MailCheck, XCircle } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'

export default function InvitationPage({ token }) {
  const [state, setState] = useState('loading')
  const [message, setMessage] = useState('Verificando invitación…')

  useEffect(() => {
    let active = true
    if (!isSupabaseConfigured) { setState('error'); setMessage('La invitación requiere una conexión activa con Supabase.'); return undefined }
    supabase.auth.getUser().then(async ({ data }) => {
      if (!active) return
      if (!data.user) { setState('login'); setMessage('Iniciá sesión con el email invitado para aceptar el acceso.'); return }
      const { data: accepted, error } = await supabase.rpc('accept_barberia_invitation', { p_token: token })
      if (!active) return
      if (error) { setState('error'); setMessage(error.message || 'La invitación no es válida o expiró.'); return }
      setState('success'); setMessage(`Acceso concedido como ${accepted?.role || 'colaborador'}.`)
    })
    return () => { active = false }
  }, [token])

  const icon = state === 'success' ? <CheckCircle2 size={42} /> : state === 'error' ? <XCircle size={42} /> : state === 'login' ? <MailCheck size={42} /> : <LoaderCircle className="spin" size={42} />
  return <main className="auth-shell"><section className="auth-card invitation-card">{icon}<p className="auth-kicker">Austral Automatizaciones</p><h1 className="auth-title">Invitación de equipo</h1><p className="auth-copy">{message}</p>{state === 'login' && <button className="btn btn-primary" onClick={() => window.location.assign(`/ingresar?redirect=${encodeURIComponent(window.location.pathname)}`)}>Iniciar sesión</button>}{state === 'success' && <button className="btn btn-primary" onClick={() => window.location.assign('/')}>Entrar al panel</button>}{state === 'error' && <button className="btn" onClick={() => window.location.assign('/')}>Volver</button>}</section></main>
}
