import { DelayedSkeletonScreen } from './SkeletonScreens.jsx'

// Mientras se confirma el workspace mostramos la silueta del panel (sidebar,
// encabezado, métricas y paneles) en lugar de un cartel con spinner. El texto
// accesible queda oculto visualmente pero disponible para lectores de pantalla.
export default function WorkspacePreparing({ businessName = 'tu espacio' }) {
  return (
    <main className="workspace-preparing skeleton-screen" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Preparando {businessName}… Cargando…</span>
      <DelayedSkeletonScreen variant="dashboard" />
    </main>
  )
}
