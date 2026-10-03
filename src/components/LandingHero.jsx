import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  CirclePlay,
  Globe2,
  Menu,
  Sparkles,
  X,
} from 'lucide-react'
import { getVerticalProfile, normalizeVertical } from '../lib/tenant'
import { COMMERCIAL_TRIAL_DAYS } from '../lib/commercialCatalog'
import { ProductVisual } from './LandingProductVisual.jsx'
import './landing.css'

export default function LandingHero({ vertical = 'custom' }) {
  const normalizedVertical = normalizeVertical(vertical)
  const profile = useMemo(() => getVerticalProfile(normalizedVertical), [normalizedVertical])
  const [menuOpen, setMenuOpen] = useState(false)
  const [productView, setProductView] = useState('agenda')
  const menuButtonRef = useRef(null)
  const [theme] = useState(() => {
    try {
      const saved = localStorage.getItem('austral-public-theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch { /* storage is optional */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    const previousTheme = document.documentElement.getAttribute('data-theme')
    document.documentElement.setAttribute('data-theme', theme)
    return () => {
      if (previousTheme) document.documentElement.setAttribute('data-theme', previousTheme)
      else document.documentElement.removeAttribute('data-theme')
    }
  }, [theme])

  // El menú móvil se cierra con Escape (devolviendo el foco al botón) y al
  // volver a un ancho de escritorio, para no quedar abierto fuera de contexto.
  useEffect(() => {
    if (!menuOpen) return undefined
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }
    const desktop = window.matchMedia?.('(min-width: 1041px)')
    const onDesktop = (event) => { if (event.matches) setMenuOpen(false) }
    document.addEventListener('keydown', onKeyDown)
    desktop?.addEventListener?.('change', onDesktop)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      desktop?.removeEventListener?.('change', onDesktop)
    }
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)
  const isBarberia = normalizedVertical === 'barberia'

  return (
    <>
      <header className="marketing-header">
        <nav className="marketing-nav" aria-label="Navegación principal">
          <a className="marketing-brand" href="/" onClick={closeMenu} aria-label="Austral Automatizaciones, inicio"><span className="marketing-brand-mark" aria-hidden="true">A</span><span><strong>Austral</strong><small>Automatizaciones</small></span></a>
          <button ref={menuButtonRef} type="button" className="marketing-menu-button" aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} aria-controls="marketing-navigation" onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}</button>
          <div id="marketing-navigation" className={`marketing-nav-links ${menuOpen ? 'is-open' : ''}`}>
            <a href="#producto" onClick={closeMenu}>Producto</a><a href="#funciones" onClick={closeMenu}>Funciones</a><a href="#como-funciona" onClick={closeMenu}>Cómo funciona</a><a href="#planes" onClick={closeMenu}>Planes</a><a href="#faq" onClick={closeMenu}>Preguntas</a>
            <span className="marketing-nav-divider" aria-hidden="true" />
            <a className="marketing-mobile-only" href="/demo" onClick={closeMenu}>Ver demo</a><a className="marketing-mobile-only" href="/ingresar" onClick={closeMenu}>Ingresar</a><a className="marketing-nav-cta marketing-mobile-only" href="/registro?source=menu" onClick={closeMenu}>Probar gratis <ArrowRight size={15} aria-hidden="true" /></a>
          </div>
          <div className="marketing-header-actions"><a href="/ingresar">Ingresar</a><a className="marketing-nav-cta" href="/registro?source=header">Probar gratis <ArrowRight size={15} aria-hidden="true" /></a></div>
        </nav>
      </header>

      <section id="producto" className="marketing-hero" data-hero-critical="true" aria-labelledby="marketing-hero-title">
        <div className="marketing-container marketing-hero-grid">
          <div className="marketing-hero-copy">
            <span className="marketing-eyebrow"><Sparkles size={14} aria-hidden="true" /> Austral para negocios de servicios</span>
            <h1 id="marketing-hero-title">{isBarberia ? 'Turnos, equipo y clientes en un solo lugar.' : `Gestioná tu ${profile.label.toLowerCase()} con más claridad.`}</h1>
            <p>Reservas online, agenda, clientes, empleados, servicios y horarios conectados en una plataforma que se adapta a tu forma de trabajar.</p>
            <div className="marketing-actions"><a className="marketing-button primary" href="/registro">Probar gratis {COMMERCIAL_TRIAL_DAYS} días <ArrowRight size={17} aria-hidden="true" /></a><a className="marketing-button secondary" href="/demo"><CirclePlay size={17} aria-hidden="true" /> Ver la demo</a></div>
            <ul className="marketing-trust-row"><li><CheckCircle2 size={15} aria-hidden="true" /> Sin tarjeta para empezar</li><li><Globe2 size={15} aria-hidden="true" /> Desde el celular o la compu</li></ul>
          </div>
          <ProductVisual mode={productView} onChange={setProductView} />
        </div>
      </section>
    </>
  )
}
