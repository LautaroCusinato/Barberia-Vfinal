import { useState } from 'react'
import { LayoutDashboard, Calendar, MessageCircle, Users, StickyNote, Sun, Moon, Bot, LogOut, BarChart3, Scissors, BriefcaseBusiness, Users2, MoreHorizontal, X, ShieldCheck, CreditCard, Settings2 } from 'lucide-react'
import { FocusTrap } from './ui'
import { getWhatsAppDisplayState } from '../utils/whatsappDisplay'

const ITEMS = [
  { id: 'resumen', label: 'Resumen', Icon: LayoutDashboard },
  { id: 'agenda', label: 'Agenda', Icon: Calendar },
  { id: 'equipo', label: 'Equipo', Icon: Users2 },
  { id: 'mensajes', label: 'Mensajes', Icon: MessageCircle },
  { id: 'pacientes', label: 'Clientes', Icon: Users },
  { id: 'notas', label: 'Notas', Icon: StickyNote },
  { id: 'estadisticas', label: 'Estadísticas', Icon: BarChart3 },
  { id: 'operacion', label: 'Operación', Icon: BriefcaseBusiness },
  { id: 'configuracion', label: 'Configuración', Icon: Settings2 },
  { id: 'facturacion', label: 'Facturación', Icon: CreditCard },
]

const GROUPS = [
  { label: 'Trabajo diario', items: ITEMS.slice(0, 4) },
  { label: 'Clientes', items: ITEMS.slice(4, 6) },
  { label: 'Gestión', items: ITEMS.slice(6) },
]

// En el celular, abajo del todo, solo entran comodas 4 secciones + "Mas".
// Las 4 mas usadas van directo en la barra; el resto queda en el desplegable.
const TABBAR_PRINCIPAL = ['resumen', 'agenda', 'mensajes', 'pacientes']
const TABBAR_MAS = ITEMS.filter((i) => !TABBAR_PRINCIPAL.includes(i.id))

export default function Sidebar({ view, setView, clinicName, unreadCount, theme, onToggleTheme, onToggleBot, whatsappStatus = {}, onConfigureWhatsApp, onOpenBilling, onLogout, onAccountSecurity, branding, demoMode = false }) {
  const isDark = theme === 'dark'
  const whatsappDisplay = getWhatsAppDisplayState({
    configured: Boolean(whatsappStatus.configured),
    connected: Boolean(whatsappStatus.connected),
    connectionStatus: whatsappStatus.connectionStatus,
    estado: whatsappStatus.estado,
    statusUnavailable: whatsappStatus.statusUnavailable === true,
    entitlement: whatsappStatus.entitlement ?? (whatsappStatus.entitled === true ? 'allowed' : 'unknown'),
    entitlementLoading: whatsappStatus.entitlementLoading === true,
    demoMode,
  })
  const whatsappState = whatsappDisplay.connectionState
  const requiresPlan = whatsappDisplay.requiresPlan
  const billingUnavailable = whatsappDisplay.billingUnavailable
  const whatsappReady = whatsappDisplay.whatsappReady
  const whatsappStatusDescriptionIds = [
    whatsappDisplay.connectionNotice ? 'whatsapp-connection-notice' : null,
    whatsappDisplay.entitlementLabel ? 'whatsapp-entitlement-status' : null,
  ].filter(Boolean)
  const [mostrarMas, setMostrarMas] = useState(false)
  const enSeccionMas = TABBAR_MAS.some((i) => i.id === view)

  const irA = (id) => {
    setView(id)
    setMostrarMas(false)
  }

  return (
    <>
      <aside className="sidebar">
        <div className="brand" style={{ '--tenant-accent': branding?.color_principal || undefined, '--tenant-secondary': branding?.color_secundario || undefined }}>
          <div className="brand-mark" style={{ background: branding?.color_principal || undefined }}>{branding?.logo_url ? <img src={branding.logo_url} alt="" /> : <Scissors size={18} strokeWidth={2.4} />}</div>
          <div>
            <div className="brand-name">{clinicName}</div>
            <div className="brand-sub">Panel de barbería</div>
          </div>
        </div>

        <nav className="nav">
          {GROUPS.map((group) => (
            <div className="nav-section" key={group.label}>
              <p className="nav-section-label">{group.label}</p>
              {group.items.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={`nav-item ${view === id ? 'active' : ''}`}
                  aria-current={view === id ? 'page' : undefined}
                  onClick={() => setView(id)}
                >
                  <Icon size={17} strokeWidth={2} />
                  <span>{label}</span>
                  {id === 'mensajes' && unreadCount > 0 && (
                    <span className="nav-badge">{unreadCount}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className={`sidebar-whatsapp-status whatsapp-state-${whatsappState}`} aria-label="Estado de WhatsApp">
            <button className="theme-toggle" type="button" aria-describedby={['whatsapp-status', ...whatsappStatusDescriptionIds].join(' ')} onClick={onToggleBot} aria-label="Abrir configuración de WhatsApp">
              <span className="theme-toggle-label">
                <Bot size={14} />
                {demoMode ? 'WhatsApp en validación' : whatsappDisplay.connectionTitle}
              </span>
              <Settings2 size={14} aria-hidden="true" />
            </button>
            <div className="sidebar-status">
              <span className={`live-dot ${whatsappState === 'connected' ? '' : 'is-offline'}`} />
              <span id="whatsapp-status">{demoMode ? 'Disponible próximamente · sin mensajes reales' : whatsappDisplay.connectionLabel}</span>
              <span className="sidebar-status-badge">{demoMode ? 'En validación' : whatsappDisplay.connectionBadge}</span>
            </div>
            {whatsappDisplay.connectionNotice && !demoMode && <span className="sidebar-status-entitlement" id="whatsapp-connection-notice">{whatsappDisplay.connectionNotice}</span>}
            {whatsappDisplay.entitlementLabel && !demoMode && <span className="sidebar-status-entitlement" id="whatsapp-entitlement-status">{whatsappDisplay.entitlementLabel}</span>}
            {requiresPlan && onOpenBilling && <button className="sidebar-status-action" type="button" onClick={onOpenBilling}>Ver facturación y planes</button>}
            {!requiresPlan && !billingUnavailable && !whatsappReady && whatsappDisplay.canConfigure && onConfigureWhatsApp && <button className="sidebar-status-action" type="button" onClick={onConfigureWhatsApp}>Configurar integración</button>}
            {billingUnavailable && onOpenBilling && <button className="sidebar-status-action" type="button" onClick={onOpenBilling}>Revisar facturación</button>}
          </div>
          <button className="theme-toggle" type="button" aria-pressed={isDark} onClick={onToggleTheme}>
            <span className="theme-toggle-label">
              {isDark ? <Moon size={14} /> : <Sun size={14} />}
              Modo {isDark ? 'oscuro' : 'claro'}
            </span>
            <span className={`theme-switch ${isDark ? 'on' : ''}`}>
              <span className="theme-switch-knob" />
            </span>
          </button>
          {onAccountSecurity && <button className="theme-toggle" type="button" onClick={onAccountSecurity}><span className="theme-toggle-label"><ShieldCheck size={14} /> Mi cuenta</span></button>}
          <button className="theme-toggle" type="button" aria-label="Cerrar sesión" onClick={onLogout}>
            <span className="theme-toggle-label">
              <LogOut size={14} />
              Cerrar sesión
            </span>
          </button>
        </div>
      </aside>

      {mostrarMas && (
        <div className="mobile-mas-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setMostrarMas(false) }}>
          <FocusTrap onEscape={() => setMostrarMas(false)} className="mobile-mas-sheet" role="dialog" aria-modal="true" aria-label="Más secciones">
            <div className="mobile-mas-header">
              <h2>Más secciones</h2>
              <button className="btn-icon-plain" onClick={() => setMostrarMas(false)} aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>
            {TABBAR_MAS.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={'mobile-mas-item ' + (view === id ? 'active' : '')}
                aria-current={view === id ? 'page' : undefined}
                onClick={() => irA(id)}
              >
                <Icon size={18} strokeWidth={2} />
                {label}
              </button>
            ))}
            <button className="mobile-mas-item" type="button" aria-pressed={isDark} onClick={onToggleTheme}>
              {isDark ? <Moon size={18} strokeWidth={2} /> : <Sun size={18} strokeWidth={2} />}
              Modo {isDark ? 'oscuro' : 'claro'}
            </button>
            <button className="mobile-mas-item mobile-mas-item-danger" aria-label="Cerrar sesión" onClick={onLogout}>
              <LogOut size={18} strokeWidth={2} />
              Cerrar sesión
            </button>
          </FocusTrap>
        </div>
      )}

      <nav className="mobile-tabbar">
        {ITEMS.filter((i) => TABBAR_PRINCIPAL.includes(i.id)).map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`mobile-tab-item ${view === id ? 'active' : ''}`}
            aria-current={view === id ? 'page' : undefined}
            onClick={() => irA(id)}
          >
            <Icon size={20} strokeWidth={2} />
            {label}
            {id === 'mensajes' && unreadCount > 0 && (
              <span className="mobile-tab-badge">{unreadCount}</span>
            )}
          </button>
        ))}
        <button
          className={`mobile-tab-item ${mostrarMas || enSeccionMas ? 'active' : ''}`}
          onClick={() => setMostrarMas((v) => !v)}
        >
          <MoreHorizontal size={20} strokeWidth={2} />
          Más
        </button>
      </nav>
    </>
  )
}
