import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { reportClientError } from '../lib/observability'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    reportClientError(error, { source: 'react-boundary', component_stack: String(info?.componentStack || '').slice(0, 1000) })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="error-boundary" role="alert">
        <section className="error-boundary-card">
          <AlertTriangle size={28} aria-hidden="true" />
          <p className="auth-kicker">Error inesperado</p>
          <h1>No pudimos mostrar esta pantalla</h1>
          <p>La operación no se perdió. Recargá la página o volvé a intentar.</p>
          <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
            <RefreshCw size={15} /> Recargar
          </button>
        </section>
      </main>
    )
  }
}
