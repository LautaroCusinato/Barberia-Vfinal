import { useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, LoaderCircle, MailCheck, XCircle } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { AuthPage } from './AuthLayout.jsx'

const ROLE_LABELS = { owner: 'dueño', admin: 'administrador', recepcionista: 'recepción', empleado: 'empleado', readonly: 'sólo lectura', barbero: 'barbero' }

function invitationErrorMessage(error) {
  if (error?.code === '42501') return 'Esta invitación pertenece a otro email. Cerrá sesión e ingresá con la cuenta invitada.'
  if (error?.code === '28000') return 'Iniciá sesión para aceptar la invitación.'
  return 'La invitación no es válida, ya fue utilizada o venció. Pedile al negocio que te envíe una nueva.'
}

export default function InvitationPage({ token }) {
  const [state, setState] = useState('loading')
  const [message, setMessage] = useState('Verificando invitación…')

  useEffect(() => {
    let active = true
    if (!isSupabaseConfigured) { setState('error'); setMessage('Las invitaciones no están disponibles en este momento. Intentá más tarde.'); return undefined }
    supabase.auth.getUser().then(async ({ data }) => {
      if (!active) return
      if (!data.user) { setState('login'); setMessage('Iniciá sesión o creá tu cuenta con el email invitado para sumarte al equipo.'); return }
      const { data: accepted, error } = await supabase.rpc('accept_barberia_invitation', { p_token: token })
      if (!active) return
      if (error) { setState('error'); setMessage(invitationErrorMessage(error)); return }
      const role = ROLE_LABELS[accepted?.role] || 'colaborador'
      setState('success'); setMessage(`Listo: ya tenés acceso al negocio como ${role}.`)
    }).catch(() => {
      if (!active) return
      setState('error'); setMessage('No pudimos verificar la invitación. Revisá tu conexión e intentá nuevamente.')
    })
    return () => { active = false }
  }, [token])

  const redirect = encodeURIComponent(window.location.pathname)
  const icon = state === 'success' ? <CheckCircle2 size={24} aria-hidden="true" /> : state === 'error' ? <XCircle size={24} aria-hidden="true" /> : state === 'login' ? <MailCheck size={24} aria-hidden="true" /> : <LoaderCircle className="spin" size={24} aria-hidden="true" />
  const tone = state === 'success' ? 'is-success' : state === 'error' ? 'is-danger' : ''

  return (
    <AuthPage cardClassName="auth-center" cardProps={{ 'aria-live': 'polite', 'aria-busy': state === 'loading' }}>
      <div className={`auth-icon-badge ${tone}`}>{icon}</div>
      <p className="auth-kicker">Invitación</p>
      <h1 className="auth-title">Invitación de equipo</h1>
      <p className="auth-copy">{message}</p>
      <div className="auth-actions">
        {state === 'login' && <>
          <a className="btn btn-primary auth-full-button" href={`/ingresar?redirect=${redirect}`}>Iniciar sesión <ArrowRight size={15} aria-hidden="true" /></a>
          <a className="btn auth-secondary-button" href={`/registro?redirect=${redirect}`}>Crear mi cuenta</a>
        </>}
        {state === 'success' && <a className="btn btn-primary auth-full-button" href="/">Entrar al panel <ArrowRight size={15} aria-hidden="true" /></a>}
        {state === 'error' && <a className="btn auth-secondary-button" href="/">Ir al inicio</a>}
      </div>
    </AuthPage>
  )
}
