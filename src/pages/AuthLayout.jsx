import { useEffect, useId } from 'react'
import { AlertCircle } from 'lucide-react'
import './auth.css'

const PUBLIC_THEME_KEY = 'austral-public-theme'

export function readPublicTheme() {
  try {
    const saved = localStorage.getItem(PUBLIC_THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* storage is optional */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Las pantallas de acceso usan la misma preferencia que la landing (o la del
// sistema). Fijar data-theme activa los tokens completos de modo oscuro,
// incluido --on-accent para el texto de los botones primarios.
export function usePublicTheme() {
  useEffect(() => {
    const root = document.documentElement
    const previous = root.getAttribute('data-theme')
    root.setAttribute('data-theme', readPublicTheme())
    return () => {
      if (previous) root.setAttribute('data-theme', previous)
      else root.removeAttribute('data-theme')
    }
  }, [])
}

export function AuthBrand() {
  return (
    <a className="auth-brand-link" href="/" aria-label="Austral Automatizaciones, ir al inicio">
      <span className="auth-brand-mark" aria-hidden="true">A</span>
      <span className="auth-brand-text"><strong>Austral</strong><small>Automatizaciones</small></span>
    </a>
  )
}

// Marco común: marca arriba (vuelve a la landing), tarjeta centrada y pie.
export function AuthPage({ children, wide = false, headerAction = null, cardProps = {}, cardClassName = '' }) {
  usePublicTheme()
  return (
    <div className={`auth-page ${wide ? 'auth-page--wide' : ''}`}>
      <header className="auth-page-header"><AuthBrand />{headerAction}</header>
      <main className="auth-page-main">
        <div {...cardProps} className={`auth-card fade-in ${wide ? 'auth-card-wide' : ''} ${cardClassName}`.trim()}>{children}</div>
      </main>
      <footer className="auth-page-footer">© {new Date().getFullYear()} Austral Automatizaciones</footer>
    </div>
  )
}

// Campo con etiqueta visible, ayuda y error accesibles (aria-describedby).
export function AuthField({ label, id, hint, error, optional = false, children }) {
  const generated = useId()
  const fieldId = id || generated
  const hintId = hint ? `${fieldId}-hint` : undefined
  const errorId = error ? `${fieldId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={`auth-field ${error ? 'has-error' : ''}`}>
      <label className="auth-field-label" htmlFor={fieldId}>{label}{optional && <span className="auth-field-optional"> (opcional)</span>}</label>
      {children({ id: fieldId, 'aria-describedby': describedBy, 'aria-invalid': error ? 'true' : undefined })}
      {hint && <span id={hintId} className="auth-field-hint">{hint}</span>}
      {error && <span id={errorId} className="auth-field-error"><AlertCircle size={13} aria-hidden="true" /> {error}</span>}
    </div>
  )
}

export function AuthAlert({ children, tone = 'error' }) {
  if (!children) return null
  return tone === 'error'
    ? <p className="login-error auth-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> <span>{children}</span></p>
    : <p className="auth-message auth-alert" role="status" aria-live="polite">{children}</p>
}
