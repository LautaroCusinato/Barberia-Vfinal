import { useEffect, useState } from 'react'

// Mismo markup que <Skeleton> de ./ui (clase .ui-skeleton), pero sin importar
// ese módulo: esta pantalla vive en el bundle inicial (main.jsx) y traer
// ./ui movería ui.css antes de index.css/polish.css, alterando la cascada.
// La base visual de .ui-skeleton para este contexto está en interactions.css.
function Skeleton({ width = '100%', height = 12, className = '' }) {
  return <span aria-hidden="true" className={`ui-skeleton${className ? ` ${className}` : ''}`} style={{ width, height }} />
}

// Para cargas rápidas no mostramos nada: el esqueleto aparece recién
// después de este umbral y así evitamos el parpadeo "esqueleto → pantalla".
export const SKELETON_DELAY_MS = 150

export function useDelayedMount(delay = SKELETON_DELAY_MS) {
  const [visible, setVisible] = useState(delay <= 0)
  useEffect(() => {
    if (delay <= 0) return undefined
    const id = window.setTimeout(() => setVisible(true), delay)
    return () => window.clearTimeout(id)
  }, [delay])
  return visible
}

const APP_PATHS = ['/', '/demo', '/plataforma', '/onboarding']

// Elige la silueta según la ruta: panel (Resumen), agenda (calendario) o
// una página genérica para pantallas públicas como login o reservas.
export function skeletonVariantForLocation(location = typeof window !== 'undefined' ? window.location : null) {
  if (!location) return 'page'
  const { pathname = '/', search = '' } = location
  const isApp = APP_PATHS.some((p) => pathname === p || (p !== '/' && pathname.startsWith(`${p}/`)))
  if (!isApp) return 'page'
  const view = new URLSearchParams(search).get('view')
  return view === 'agenda' ? 'calendar' : 'dashboard'
}

function SidebarSkeleton() {
  return (
    <aside className="sk-sidebar">
      <div className="sk-brand">
        <Skeleton width={34} height={34} className="sk-round-md" />
        <div className="sk-stack">
          <Skeleton width={110} height={12} />
          <Skeleton width={72} height={9} />
        </div>
      </div>
      <div className="sk-nav">
        {[78, 64, 86, 70, 58, 74, 66].map((w, i) => (
          <div className="sk-nav-item" key={i}>
            <Skeleton width={18} height={18} className="sk-round-sm" />
            <Skeleton width={`${w}%`} height={11} />
          </div>
        ))}
      </div>
    </aside>
  )
}

function TabbarSkeleton() {
  return (
    <div className="sk-tabbar">
      {[0, 1, 2, 3, 4].map((i) => (
        <div className="sk-tab" key={i}>
          <Skeleton width={22} height={22} className="sk-round-sm" />
          <Skeleton width={38} height={7} />
        </div>
      ))}
    </div>
  )
}

function HeaderSkeleton() {
  return (
    <div className="sk-header">
      <div className="sk-stack">
        <Skeleton width={180} height={26} />
        <Skeleton width={240} height={12} />
      </div>
      <Skeleton width={128} height={38} className="sk-round-md sk-header-action" />
    </div>
  )
}

function StatCardsSkeleton() {
  return (
    <div className="sk-stats">
      {[0, 1, 2, 3].map((i) => (
        <div className="sk-card sk-stat" key={i}>
          <div className="sk-stack">
            <Skeleton width="62%" height={11} />
            <Skeleton width={56} height={26} />
          </div>
          <Skeleton width={34} height={34} className="sk-round-md" />
        </div>
      ))}
    </div>
  )
}

function PanelSkeleton({ rows = 5 }) {
  return (
    <div className="sk-card sk-panel">
      <div className="sk-panel-head">
        <Skeleton width="38%" height={15} />
        <Skeleton width={64} height={11} />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div className="sk-row" key={i}>
          <Skeleton width={34} height={34} className="sk-round-full" />
          <div className="sk-stack sk-grow">
            <Skeleton width={`${70 - (i % 3) * 12}%`} height={11} />
            <Skeleton width={`${46 - (i % 2) * 10}%`} height={9} />
          </div>
          <Skeleton width={58} height={22} className="sk-round-md" />
        </div>
      ))}
    </div>
  )
}

function DashboardBody() {
  return (
    <>
      <HeaderSkeleton />
      <StatCardsSkeleton />
      <div className="sk-panels">
        <PanelSkeleton rows={5} />
        <PanelSkeleton rows={4} />
      </div>
    </>
  )
}

function CalendarBody() {
  return (
    <>
      <HeaderSkeleton />
      <div className="sk-toolbar">
        <Skeleton width={200} height={36} className="sk-round-md" />
        <Skeleton width={150} height={36} className="sk-round-md" />
      </div>
      <div className="sk-card sk-calendar">
        <div className="sk-cal-head">
          {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} width="60%" height={11} />)}
        </div>
        <div className="sk-cal-grid">
          {Array.from({ length: 7 * 5 }, (_, i) => (
            <div className="sk-cal-cell" key={i}>
              {(i * 7) % 3 === 0 && <Skeleton width="85%" height={28} className="sk-round-sm" />}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function PageBody() {
  return (
    <div className="sk-card sk-page-card">
      <Skeleton width={44} height={44} className="sk-round-md" />
      <Skeleton width="60%" height={20} />
      <Skeleton width="85%" height={12} />
      <Skeleton width="100%" height={42} className="sk-round-md" />
      <Skeleton width="100%" height={42} className="sk-round-md" />
    </div>
  )
}

// Silueta visual de la pantalla. Es puramente decorativa (aria-hidden): el
// contenedor que la usa es quien expone role="status" y el texto accesible.
export function SkeletonScreen({ variant = 'dashboard' }) {
  if (variant === 'page') {
    return <div className="sk-screen sk-screen--page" aria-hidden="true"><PageBody /></div>
  }
  return (
    <div className={`sk-screen sk-screen--${variant}`} aria-hidden="true">
      <SidebarSkeleton />
      <div className="sk-main">
        {variant === 'calendar' ? <CalendarBody /> : <DashboardBody />}
      </div>
      <TabbarSkeleton />
    </div>
  )
}

export function DelayedSkeletonScreen({ variant, delay = SKELETON_DELAY_MS }) {
  const visible = useDelayedMount(delay)
  return visible ? <SkeletonScreen variant={variant} /> : null
}
