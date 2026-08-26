import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { logout } from './lib/auth.js'
import { supabase, isSupabaseConfigured } from './lib/supabaseClient'
import { DEFAULT_BUSINESS_NAME, DEFAULT_TENANT_ID, DEFAULT_VERTICAL } from './lib/tenant'
import { clearWorkspacePreference, readWorkspacePreference, saveWorkspacePreference } from './lib/workspacePreference.js'
import { clearWorkspaceTransition, hasWorkspaceTransition } from './lib/workspaceTransition.js'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import LandingHero from './components/LandingHero.jsx'
import WorkspacePreparing from './components/WorkspacePreparing.jsx'
import { installGlobalObservability, trackClientEvent } from './lib/observability.js'
import './index.css'
import './components/polish.css'

const App = lazy(() => import('./App.jsx'))
const DemoWorkspace = lazy(() => import('./pages/DemoWorkspace.jsx'))
const PlatformCRM = lazy(() => import('./pages/PlatformCRM.jsx'))
const Login = lazy(() => import('./components/Login.jsx'))
const PublicBooking = lazy(() => import('./pages/PublicBooking.jsx'))
const Signup = lazy(() => import('./pages/Signup.jsx'))
const OnboardingWizard = lazy(() => import('./pages/OnboardingWizard.jsx'))
const PasswordRecovery = lazy(() => import('./pages/PasswordRecovery.jsx'))
const AccountSecurity = lazy(() => import('./pages/AccountSecurity.jsx'))
const InvitationPage = lazy(() => import('./pages/InvitationPage.jsx'))
const Landing = lazy(() => import('./pages/Landing.jsx'))
const AuthConfirm = lazy(() => import('./pages/AuthConfirm.jsx'))

installGlobalObservability()

// Pantalla chica y centrada para los estados intermedios (cargando la
// barberia, error, o el selector cuando el usuario pertenece a mas de una).
function EstadoCentrado({ children }) {
  return <main className="centered-state"><div className="centered-state__card">{children}</div></main>
}

function SelectorBarberia({ opciones, onElegir }) {
  return (
    <EstadoCentrado>
      <p className="centered-state__eyebrow">Tus negocios</p>
      <h1 className="centered-state__title">¿Con cuál negocio querés entrar?</h1>
      <div className="centered-state__actions">
        {opciones.map((o) => (
          <button
            key={o.barberia_id}
            className="btn btn-primary"
            onClick={() => onElegir(o.barberia_id)}
          >
            {o.barberias?.nombre || `Barbería #${o.barberia_id}`}
          </button>
        ))}
      </div>
    </EstadoCentrado>
  )
}

function SelectorWorkspace({ opciones, platformRole, onElegirPlataforma, onElegirNegocio }) {
  return (
    <EstadoCentrado>
      <p className="centered-state__eyebrow">Workspace</p>
      <h1 className="centered-state__title">¿A qué workspace querés entrar?</h1>
      <p style={{ color: 'var(--ink-faint)', fontSize: 13.5, marginBottom: 20 }}>
        Tu cuenta tiene permisos de plataforma y también acceso a un negocio.
      </p>
      <div className="centered-state__actions">
        <button
          className="btn btn-primary"
          onClick={onElegirPlataforma}
        >
          Plataforma · {platformRole || 'owner'}
        </button>
        {opciones.map((o) => (
          <button
            key={o.barberia_id}
            className="btn"
            onClick={() => onElegirNegocio(o.barberia_id)}
          >
            Negocio · {o.barberias?.nombre || `Barbería #${o.barberia_id}`}
          </button>
        ))}
      </div>
    </EstadoCentrado>
  )
}

function SinBarberia() {
  return (
    <EstadoCentrado>
      <p className="centered-state__eyebrow">Austral Automatizaciones</p>
      <h1 className="centered-state__title">Creá tu primer negocio</h1>
      <p style={{ color: 'var(--ink-faint)', fontSize: 13.5, marginBottom: 20 }}>
        Tu cuenta está lista. Completá el asistente para activar tu prueba gratuita de 14 días.
      </p>
      <div className="centered-state__actions"><button className="btn btn-primary" onClick={() => window.location.assign('/onboarding')}>Configurar negocio</button></div>
      <button className="btn" onClick={() => logout()}>Cerrar sesión</button>
    </EstadoCentrado>
  )
}

function RouteLoading() {
  return <main className="route-loading" role="status" aria-live="polite"><div className="skeleton" /><span>Cargando pantalla…</span></main>
}

const CACHE_KEY = 'barberia-activa'
const bookingMatch = window.location.pathname.match(/^\/reservar\/([^/]+)\/?$/)
const invitationMatch = window.location.pathname.match(/^\/invitacion\/([^/]+)\/?$/)
const verticalMatch = window.location.pathname.match(/^\/para\/([^/]+)\/?$/)
const path = window.location.pathname
const isPublicLandingPath = path === '/' || Boolean(verticalMatch)
function LandingFallback() {
  return (
    <div className="marketing-page" data-public-landing="true">
      <LandingHero vertical={DEFAULT_VERTICAL} />
      <LandingSectionsFallback />
    </div>
  )
}

class LandingBoundary extends React.Component {
  state = { hasError: false }

  static getDerivedStateFromError() { return { hasError: true } }

  render() {
    return this.state.hasError ? <LandingFallback /> : this.props.children
  }
}

function LandingSectionsFallback() {
  return (
    <section className="marketing-section marketing-sections-loading" aria-busy="true" aria-label="Cargando contenido del producto">
      <div className="marketing-container">
        <div className="marketing-loading-section-heading" />
        <div className="marketing-loading-section-grid"><span /><span /><span /></div>
      </div>
    </section>
  )
}

class LandingSectionsBoundary extends React.Component {
  state = { hasError: false }

  static getDerivedStateFromError() { return { hasError: true } }

  render() {
    return this.state.hasError ? <LandingSectionsFallback /> : this.props.children
  }
}

function PublicLanding({ vertical = DEFAULT_VERTICAL }) {
  return (
    <div className="marketing-page" data-public-landing="true">
      <LandingBoundary><LandingHero vertical={vertical} /></LandingBoundary>
      <LandingSectionsBoundary>
        <Suspense fallback={<LandingSectionsFallback />}>
          <Landing vertical={vertical} />
        </Suspense>
      </LandingSectionsBoundary>
    </div>
  )
}

function RootSuspenseFallback() {
  return hasWorkspaceTransition() ? <WorkspacePreparing /> : <RouteLoading />
}

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
  const [workspace, setWorkspace] = useState(null)
  const [onboardingNeeded, setOnboardingNeeded] = useState(false)
  const [workspaceTransition, setWorkspaceTransition] = useState(hasWorkspaceTransition)

  const yaResolvioAlgunaVezRef = useRef(false)
  const resolvedUserIdRef = useRef(null)
  const sessionResolutionRef = useRef(null)
  const lastBackgroundRevalidationRef = useRef(0)

  const resolverBarberia = async (userId, { preserveUi = false } = {}) => {
    const [tenantResult, platformResult] = await Promise.all([
      supabase
        .from('barberia_members')
        .select('barberia_id, role, barberias(nombre, onboarding_completed)')
        .eq('user_id', userId),
      // platform_role() is SECURITY DEFINER and returns null for tenant-only
      // users, avoiding a direct platform_members read that is correctly
      // denied by RLS outside the platform boundary.
      supabase.rpc('platform_role'),
    ])

    const { data, error } = tenantResult
    const hasPlatformMembership = Boolean(platformResult.data)
    const nextPlatformRole = platformResult.data || null
    if (error || platformResult.error) {
      // Mobile resume can be temporarily offline. Keep the authorized UI
      // mounted and retry in background instead of showing WorkspacePreparing.
      if (preserveUi && yaResolvioAlgunaVezRef.current) return false
      setOpciones([])
      setOnboardingNeeded(true)
      if (hasPlatformMembership) {
        saveWorkspacePreference('platform')
        setWorkspace('platform')
      } else {
        clearWorkspacePreference()
        setWorkspace(null)
      }
      return false
    }
    const preference = readWorkspacePreference()
    const platformPath = window.location.pathname === '/plataforma' || window.location.pathname.startsWith('/plataforma/')

    setPlatformMember(hasPlatformMembership)
    setPlatformRole(nextPlatformRole)
    yaResolvioAlgunaVezRef.current = true

    if (!data) {
      setOpciones([])
      setOnboardingNeeded(true)
      if (hasPlatformMembership) {
        saveWorkspacePreference('platform')
        setWorkspace('platform')
      } else {
        clearWorkspacePreference()
        setWorkspace(null)
      }
      return true
    }

    setOpciones(data)
    const preferredBusiness = preference?.type === 'business'
      ? data.find((option) => String(option.barberia_id) === preference.tenantId)
      : null

    // La ruta explícita tiene prioridad, pero la preferencia persistida sólo
    // se restaura después de confirmar la membresía actual.
    if (hasPlatformMembership && (platformPath || preference?.type === 'platform')) {
      saveWorkspacePreference('platform')
      setWorkspace('platform')
      setBarberiaId(null)
      setBarberiaNombre(null)
      setOnboardingNeeded(false)
      return
    }

    if (preferredBusiness) {
      saveWorkspacePreference('business', preferredBusiness.barberia_id)
      setWorkspace('business')
      setBarberiaId(preferredBusiness.barberia_id)
      setBarberiaNombre(preferredBusiness.barberias?.nombre || null)
      setOnboardingNeeded(preferredBusiness.barberias?.onboarding_completed === false)
      return true
    }

    if (preference) clearWorkspacePreference()

    if (data.length === 1) {
      const onlyBusiness = data[0]
      saveWorkspacePreference('business', onlyBusiness.barberia_id)
      setWorkspace('business')
      setBarberiaId(onlyBusiness.barberia_id)
      setBarberiaNombre(onlyBusiness.barberias?.nombre || null)
      setOnboardingNeeded(onlyBusiness.barberias?.onboarding_completed === false)
      return true
    }

    setWorkspace(null)
    setOnboardingNeeded(false)
    return true
  }

  useEffect(() => {
    guardarCache(barberiaId, barberiaNombre)
  }, [barberiaId, barberiaNombre])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setChecking(false)
      return
    }

    let mounted = true

    const resolveSession = async (session, { background = false } = {}) => {
      setAuthed(Boolean(session))
      if (!session) {
        resolvedUserIdRef.current = null
        yaResolvioAlgunaVezRef.current = false
        clearWorkspacePreference()
        clearWorkspaceTransition()
        setWorkspaceTransition(false)
        setChecking(false)
        return
      }

      const sameResolvedUser = resolvedUserIdRef.current === session.user.id && yaResolvioAlgunaVezRef.current
      if (sameResolvedUser || background) {
        await resolverBarberia(session.user.id, { preserveUi: true })
        return
      }

      setChecking(true)
      try {
        const resolved = await resolverBarberia(session.user.id)
        if (resolved !== false) {
          resolvedUserIdRef.current = session.user.id
          yaResolvioAlgunaVezRef.current = true
        }
      } finally {
        clearWorkspaceTransition()
        if (mounted) {
          setWorkspaceTransition(false)
          setChecking(false)
        }
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!sessionResolutionRef.current) {
        sessionResolutionRef.current = resolveSession(data.session).finally(() => { sessionResolutionRef.current = null })
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthed(Boolean(session))
      if (!session) {
        resolvedUserIdRef.current = null
        yaResolvioAlgunaVezRef.current = false
        clearWorkspacePreference()
        setOpciones(null)
        setBarberiaId(null)
        setBarberiaNombre(null)
        setPlatformMember(false)
        setPlatformRole(null)
        setWorkspace(null)
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
        if (!sessionResolutionRef.current) {
          sessionResolutionRef.current = resolveSession(session).finally(() => { sessionResolutionRef.current = null })
        }
      }
    })

    const revalidateInBackground = () => {
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - lastBackgroundRevalidationRef.current < 30_000) return
      lastBackgroundRevalidationRef.current = now
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) {
          resolveSession(null)
          return
        }
        if (!sessionResolutionRef.current) {
          sessionResolutionRef.current = resolveSession(data.session, { background: true }).finally(() => { sessionResolutionRef.current = null })
        }
      })
    }
    document.addEventListener('visibilitychange', revalidateInBackground)
    window.addEventListener('focus', revalidateInBackground)

    return () => {
      mounted = false
      listener?.subscription?.unsubscribe()
      document.removeEventListener('visibilitychange', revalidateInBackground)
      window.removeEventListener('focus', revalidateInBackground)
    }
  }, [])

  if (checking) return workspaceTransition ? <WorkspacePreparing /> : (isPublicLandingPath ? <LandingFallback /> : <RouteLoading />)
  // En modo demo local no hay sesión real: conservamos el panel de ejemplo.
  if (!isSupabaseConfigured) {
    return <App barberiaId={DEFAULT_TENANT_ID} barberiaNombre={DEFAULT_BUSINESS_NAME} vertical={DEFAULT_VERTICAL} />
  }
  if (!authed) return <PublicLanding vertical={DEFAULT_VERTICAL} />

  const platformPath = window.location.pathname === '/plataforma' || window.location.pathname.startsWith('/plataforma/')
  if (platformMember && (platformPath || workspace === 'platform' || (opciones !== null && opciones.length === 0))) {
    return <PlatformCRM role={platformRole || 'owner'} />
  }

  if (platformMember && opciones !== null && opciones.length > 0 && workspace !== 'business') {
    return (
      <SelectorWorkspace
        opciones={opciones}
        platformRole={platformRole}
        onElegirPlataforma={() => {
          saveWorkspacePreference('platform')
          setWorkspace('platform')
          window.location.assign('/plataforma')
        }}
        onElegirNegocio={(id) => {
          saveWorkspacePreference('business', id)
          setWorkspace('business')
          setBarberiaId(id)
          setBarberiaNombre(opciones.find((o) => o.barberia_id === id)?.barberias?.nombre || null)
        }}
      />
    )
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
          saveWorkspacePreference('business', id)
          setBarberiaId(id)
          setBarberiaNombre(opciones.find((o) => o.barberia_id === id)?.barberias?.nombre || null)
        }}
      />
    )
  }

  return <App barberiaId={barberiaId} barberiaNombre={barberiaNombre} vertical={DEFAULT_VERTICAL} />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
    <Suspense fallback={isPublicLandingPath ? <LandingFallback /> : <RootSuspenseFallback />}>
    {bookingMatch ? <PublicBooking slug={decodeURIComponent(bookingMatch[1])} />
      : invitationMatch ? <InvitationPage token={decodeURIComponent(invitationMatch[1])} />
        : path === '/ingresar' ? <Login businessName="Austral Automatizaciones" onSuccess={() => window.location.assign('/')} />
          : path === '/auth/confirm' ? <AuthConfirm />
          : verticalMatch ? <PublicLanding vertical={decodeURIComponent(verticalMatch[1])} />
        : (path === '/registro' || path === '/registrarse') ? <Signup />
        : path === '/demo' ? <DemoWorkspace />
        : path === '/onboarding' ? <OnboardingWizard />
            : path === '/recuperar' ? <PasswordRecovery />
              : path === '/cuenta' ? <AccountSecurity />
              : <Root />}
    </Suspense>
    </ErrorBoundary>
  </React.StrictMode>
)

trackClientEvent('route_view', { route: path })
