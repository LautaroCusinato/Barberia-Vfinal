import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  LayoutDashboard,
  Scissors,
  Settings2,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'

export const PRODUCT_VIEWS = [
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'booking', label: 'Reserva pública', icon: CalendarCheck },
  { id: 'management', label: 'Gestión', icon: LayoutDashboard },
  { id: 'crm', label: 'CRM', icon: BarChart3 },
]

export function ProductPreview({ mode }) {
  if (mode === 'booking') {
    return (
      <div className="marketing-preview marketing-preview-booking" aria-label="Representación de la reserva pública">
        <div className="marketing-preview-header"><span className="marketing-preview-dot" /><div><strong>Barbería Central</strong><small>Elegí tu próximo turno</small></div><span className="marketing-preview-live">Online</span></div>
        <div className="marketing-booking-progress"><span className="is-active">1 Servicio</span><span>2 Fecha y hora</span><span>3 Tus datos</span></div>
        <div className="marketing-booking-card"><small>Servicio</small><div className="marketing-booking-option is-selected"><span><strong>Corte clásico</strong><small>30 min · precio configurado</small></span><CheckCircle2 size={18} /></div><div className="marketing-booking-option"><span><strong>Barba</strong><small>30 min · precio configurado</small></span><span className="marketing-option-check" /></div></div>
        <div className="marketing-booking-footer"><span><Clock3 size={14} /> Disponibilidad actualizada</span><ArrowRight size={16} /></div>
      </div>
    )
  }

  if (mode === 'management') {
    return (
      <div className="marketing-preview marketing-preview-management" aria-label="Representación del panel de gestión">
        <div className="marketing-preview-header"><span className="marketing-preview-dot" /><div><strong>Workspace del negocio</strong><small>Todo en un solo lugar</small></div><span className="marketing-preview-avatar">B</span></div>
        <div className="marketing-management-grid"><article><UsersRound size={17} /><small>Clientes</small><strong>Ficha e historial</strong><span>Consultá la información cuando la necesitás.</span></article><article><Scissors size={17} /><small>Servicios</small><strong>Duración y precio</strong><span>Ordená tu catálogo y disponibilidad.</span></article><article><CalendarDays size={17} /><small>Horarios</small><strong>Jornadas y breaks</strong><span>La agenda respeta tu forma de trabajar.</span></article><article><Settings2 size={17} /><small>Configuración</small><strong>Marca y reservas</strong><span>Ajustes agrupados para administrar mejor.</span></article></div>
      </div>
    )
  }

  if (mode === 'crm') {
    return (
      <div className="marketing-preview marketing-preview-crm" aria-label="Representación del CRM comercial">
        <div className="marketing-preview-header"><span className="marketing-preview-dot" /><div><strong>CRM comercial</strong><small>Pipeline y seguimientos</small></div><BarChart3 size={18} /></div>
        <div className="marketing-crm-columns"><div><small>Descubiertos</small><article><strong>Nuevo negocio</strong><span>Próxima acción</span></article><article><strong>Consulta inicial</strong><span>Sin contacto</span></article></div><div><small>Interesados</small><article className="is-highlight"><strong>Demo solicitada</strong><span>Seguimiento</span></article><article><strong>Evaluación</strong><span>Plan en revisión</span></article></div><div><small>Convertidos</small><article><strong>Cuenta activa</strong><span>Onboarding</span></article></div></div>
      </div>
    )
  }

  return (
    <div className="marketing-preview marketing-preview-agenda" aria-label="Representación de la Agenda">
      <div className="marketing-preview-header"><span className="marketing-preview-dot" /><div><strong>Agenda</strong><small>Miércoles · vista del día</small></div><span className="marketing-preview-date">Hoy</span></div>
      <div className="marketing-agenda-layout"><div className="marketing-agenda-times"><span>09:00</span><span>10:00</span><span>11:00</span><span>12:00</span><span>13:00</span></div><div className="marketing-agenda-track"><span className="marketing-agenda-line line-1" /><span className="marketing-agenda-line line-2" /><span className="marketing-agenda-line line-3" /><span className="marketing-agenda-line line-4" /><article className="marketing-turno turno-one"><strong>Cliente · Corte clásico</strong><small>Barbero · 30 min</small></article><article className="marketing-turno turno-two"><strong>Cliente · Barba</strong><small>Barbero · 30 min</small></article><div className="marketing-break"><Clock3 size={13} /> Break</div></div></div>
      <div className="marketing-preview-legend"><span><i className="legend-dot is-booked" /> Turnos</span><span><i className="legend-dot is-break" /> Breaks</span><span><i className="legend-dot is-free" /> Disponibilidad</span></div>
    </div>
  )
}

export function ProductVisual({ mode, onChange }) {
  return (
    <div className="marketing-product-visual">
      <div className="marketing-product-tabs" role="tablist" aria-label="Vistas del producto">
        {PRODUCT_VIEWS.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={mode === id} className={mode === id ? 'is-active' : ''} onClick={() => onChange(id)}><Icon size={15} /> {label}</button>)}
      </div>
      <ProductPreview mode={mode} />
      <p className="marketing-product-note"><ShieldCheck size={14} /> Representación visual basada en interfaces existentes. Los datos mostrados son ilustrativos.</p>
    </div>
  )
}
