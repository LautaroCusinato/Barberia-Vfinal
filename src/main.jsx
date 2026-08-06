import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import PublicBooking from './pages/PublicBooking.jsx'
import PlatformCRM from './pages/PlatformCRM.jsx'
import Signup from './pages/Signup.jsx'
import OnboardingWizard from './pages/OnboardingWizard.jsx'
import PasswordRecovery from './pages/PasswordRecovery.jsx'
import AccountSecurity from './pages/AccountSecurity.jsx'
import InvitationPage from './pages/InvitationPage.jsx'
import Landing from './pages/Landing.jsx'
import Login, { logout } from './components/Login.jsx'
import { supabase, isSupabaseConfigured } from './lib/supabaseClient'
import { DEFAULT_BUSINESS_NAME, DEFAULT_TENANT_ID, DEFAULT_VERTICAL } from './lib/tenant'
import './index.css'

// Pantalla chica y centrada para los estados intermedios (cargando la
// barberia, error, o el selector cuando el usuario pertenece a mas de una).
function EstadoCentrado({ children }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        padding: '1.5rem',
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '2rem',
          maxWidth: 380,
          width: '100%',
          textAlign: 'center',
          color: 'var(--ink)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

function SelectorBarberia({ opciones, onElegir }) {
  return (
    <EstadoCentrado>
      <p style={{ fontWeight: 700, marginBottom: 16 }}>¿Con cuál barbería querés entrar?</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {opciones.map((o) => (
          <button
            key={o.barberia_id}
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => onElegir(o.barberia_id)}
          >
            {o.barberias?.nombre || `Barbería #${o.barberia_id}`}
          </button>
        ))}
      </div>
    </EstadoCentrado>
  )
}

function SinBarberia() {
  return (
    <EstadoCentrado>
      <p style={{ fontWeight: 700, marginBottom: 8 }}>Creá tu primer negocio</p>
      <p style={{ color: 'var(--ink-faint)', fontSize: 13.5, marginBottom: 20 }}>
        Tu cuenta está lista. Completá el asistente para activar tu prueba gratuita de 14 días.
      </p>
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }} onClick={() => window.location.assign('/onboarding')}>Configurar negocio</button>
      <button className="btn" onClick={() => logout()}>Cerrar sesión</button>
    </EstadoCentrado>
  )
}

const CACHE_KEY = 'barberia-activa'

function leerCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function guardarCache(id, nombre) {
  try {
    if (id == null) sessionStorage.removeItem(CACHE_KEY)
    else sessionStorage.setItem(CACHE_KEY, JSON.stringify({ id, nombre }))
  } catch {
    // si sessionStorage no esta disponible (algun navegador raro), no pasa nada
  }
}

function Root() {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(isSupabaseConfigured)

  // Resolucion de la barberia del usuario logueado, via barberia_members.
  // null = todavia no se resolvio (cargando); [] = no pertenece a ninguna.
  const [opciones, setOpciones] = useState(null)
  const cacheInicial = leerCache()
  const [barberiaId, setBarberiaId] = useState(cacheInicial?.id ?? null)
  const [barberiaNombre, setBarberiaNombre] = useState(cacheInicial?.nombre ?? null)
  const [platformMember, setPlatformMember] = useState(false)
  const [platformRole, setPlatformRole] = useState(null)
  const [onboardingNeeded, setOnboardingNeeded] = useState(false)

  const yaResolvioAlgunaVezRef = useRef(false)

  const resolverBarberia = async (userId) => {
    const [tenantResult, platformResult] = await Promise.all([
      supabase
        .from('barberia_members')
        .select('barberia_id, role, barberias(nombre, onboarding_completed)')
        .eq('user_id', userId),
      supabase
        .from('platform_members')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle(),
    ])

    const { data, error } = tenantResult
    setPlatformMember(Boolean(platformResult.data))
    setPlatformRole(platformResult.data?.role || null)

    yaResolvioAlgunaVezRef.current = true

    if (error || !data) {
      setOpciones([])
      setOnboardingNeeded(true)
      return
    }
    setOpciones(data)
    if (data.length === 1) {
      setBarberiaId(data[0].barberia_id)
      setBarberiaNombre(data[0].barberias?.nombre || null)
      setOnboardingNeeded(data[0].barberias?.onboarding_completed === false)
    } else {
      setOnboardingNeeded(false)
    }
  }

  useEffect(() => {
    guardarCache(barberiaId, barberiaNombre)
  }, [barberiaId, barberiaNombre])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setChecking(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      const session = data.session
      setAuthed(Boolean(session))
      setChecking(false)
      if (session) resolverBarberia(session.user.id)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthed(Boolean(session))
      if (!session) {
        setOpciones(null)
        setBarberiaId(null)
        setBarberiaNombre(null)
        setPlatformMember(false)
        setPlatformRole(null)
        setOnboardingNeeded(false)
        return
      }
      // Supabase dispara este mismo evento tambien cuando solo renueva el
      // token en segundo plano (ej: volviste a la pestaña despues de un
      // rato). En esos casos NO hay que volver a preguntar la barberia
      // (ya la tenemos resuelta) — si lo hacemos, parpadea el cartel de
      // "Cargando tu barbería..." sin necesidad. Solo resolvemos de nuevo
      // en un login real, o si por algun motivo todavia no la resolvimos.
      if (event === 'SIGNED_IN' || !yaResolvioAlgunaVezRef.current) {
        resolverBarberia(session.user.id)
      }
    })

    return () => listener?.subscription?.unsubscribe()
  }, [])

  if (checking) return null
  // En modo demo local no hay sesión real: conservamos el panel de ejemplo.
  if (!isSupabaseConfigured) {
    return <App barberiaId={DEFAULT_TENANT_ID} barberiaNombre={DEFAULT_BUSINESS_NAME} vertical={DEFAULT_VERTICAL} />
  }
  if (!authed) return <Landing vertical={DEFAULT_VERTICAL} />

  const platformPath = window.location.pathname === '/plataforma' || window.location.pathname.startsWith('/plataforma/')
  if (platformMember && (platformPath || (opciones !== null && opciones.length === 0))) {
    return <PlatformCRM role={platformRole || 'owner'} />
  }

  if (opciones === null && !barberiaId) {
    return <EstadoCentrado>Cargando tu barbería...</EstadoCentrado>
  }
  if (opciones !== null && opciones.length === 0) {
    if (onboardingNeeded) return <OnboardingWizard />
    return <SinBarberia />
  }
  if (onboardingNeeded) return <OnboardingWizard />
  if (!barberiaId) {
    return (
      <SelectorBarberia
        opciones={opciones}
        onElegir={(id) => {
          setBarberiaId(id)
          setBarberiaNombre(opciones.find((o) => o.barberia_id === id)?.barberias?.nombre || null)
        }}
      />
    )
  }

  return <App barberiaId={barberiaId} barberiaNombre={barberiaNombre} vertical={DEFAULT_VERTICAL} />
}

const bookingMatch = window.location.pathname.match(/^\/reservar\/([^/]+)\/?$/)
const invitationMatch = window.location.pathname.match(/^\/invitacion\/([^/]+)\/?$/)
const verticalMatch = window.location.pathname.match(/^\/para\/([^/]+)\/?$/)
const path = window.location.pathname

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {bookingMatch ? <PublicBooking slug={decodeURIComponent(bookingMatch[1])} />
      : invitationMatch ? <InvitationPage token={decodeURIComponent(invitationMatch[1])} />
        : path === '/ingresar' ? <Login businessName="Austral Automatizaciones" onSuccess={() => window.location.assign('/')} />
          : verticalMatch ? <Landing vertical={decodeURIComponent(verticalMatch[1])} />
        : path === '/registro' ? <Signup />
        : path === '/onboarding' ? <OnboardingWizard />
          : path === '/recuperar' ? <PasswordRecovery />
            : path === '/cuenta' ? <AccountSecurity />
              : <Root />}
  </React.StrictMode>
)
