import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowRight,
  CheckCircle2,
  Globe2,
  Menu,
  Sparkles,
  X,
} from 'lucide-react'
import { getVerticalProfile, normalizeVertical } from '../lib/tenant'
import { ProductVisual } from './LandingProductVisual.jsx'
import './landing.css'

export default function LandingHero({ vertical = 'custom' }) {
  const normalizedVertical = normalizeVertical(vertical)
  const profile = useMemo(() => getVerticalProfile(normalizedVertical), [normalizedVertical])
  const [menuOpen, setMenuOpen] = useState(false)
  const [productView, setProductView] = useState('agenda')
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

  const closeMenu = () => setMenuOpen(false)
  const isBarberia = normalizedVertical === 'barberia'

  return (
    <>
      <header className="marketing-header">
        <nav className="marketing-nav" aria-label="Navegación principal">
          <a className="marketing-brand" href="/" onClick={closeMenu}><span className="marketing-brand-mark">A</span><span><strong>Austral</strong><small>Automatizaciones</small></span></a>
          <button type="button" className="marketing-menu-button" aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} aria-controls="marketing-navigation" onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
          <div id="marketing-navigation" className={`marketing-nav-links ${menuOpen ? 'is-open' : ''}`}>
            <a href="#producto" onClick={closeMenu}>Producto</a><a href="#funciones" onClick={closeMenu}>Funciones</a><a href="#como-funciona" onClick={closeMenu}>Cómo funciona</a><a href="#planes" onClick={closeMenu}>Planes</a><a href="#faq" onClick={closeMenu}>FAQ</a>
            <span className="marketing-nav-divider" aria-hidden="true" />
            <a className="marketing-mobile-only" href="/demo" onClick={closeMenu}>Demo aislada</a><a className="marketing-mobile-only" href="/ingresar" onClick={closeMenu}>Ingresar</a><a className="marketing-nav-cta marketing-mobile-only" href="/registro?source=menu" onClick={closeMenu}>Probar gratis <ArrowRight size={15} /></a>
          </div>
          <div className="marketing-header-actions"><a href="/ingresar">Ingresar</a><a className="marketing-nav-cta" href="/registro?source=header">Probar gratis <ArrowRight size={15} /></a></div>
        </nav>
      </header>

      <section id="producto" className="marketing-hero" data-hero-critical="true">
        <div className="marketing-container marketing-hero-grid">
          <div className="marketing-hero-copy"><span className="marketing-eyebrow"><Sparkles size={14} /> Austral para negocios de servicios</span><h1>{isBarberia ? 'Turnos, equipo y clientes en un solo lugar.' : `Gestioná tu ${profile.label.toLowerCase()} con más claridad.`}</h1><p>Reservas online, agenda, clientes, empleados, servicios y horarios conectados en una plataforma que se adapta a tu forma de trabajar.</p><div className="marketing-actions"><a className="marketing-button primary" href="/registro">Probar gratis 15 días <ArrowRight size={17} /></a><a className="marketing-button secondary" href="/demo">Ver cómo funciona <ArrowDownRight size={17} /></a></div><div className="marketing-trust-row"><span><CheckCircle2 size={15} /> Sin tarjeta para empezar</span><span><Globe2 size={15} /> Desde el celular o la compu</span></div></div>
          <ProductVisual mode={productView} onChange={setProductView} />
        </div>
      </section>
    </>
  )
}
