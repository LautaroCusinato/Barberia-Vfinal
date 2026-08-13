import { LoaderCircle, Scissors } from 'lucide-react'

export default function WorkspacePreparing({ businessName = 'tu espacio' }) {
  return (
    <main className="workspace-preparing" role="status" aria-live="polite" aria-busy="true">
      <div className="workspace-preparing__card">
        <div className="workspace-preparing__mark" aria-hidden="true"><Scissors size={20} /></div>
        <p className="workspace-preparing__eyebrow">Austral Automatizaciones</p>
        <h1>Preparando {businessName}…</h1>
        <p>Estamos confirmando tu espacio y cargando los datos básicos del panel.</p>
        <LoaderCircle className="workspace-preparing__spinner" size={22} aria-hidden="true" />
      </div>
    </main>
  )
}
