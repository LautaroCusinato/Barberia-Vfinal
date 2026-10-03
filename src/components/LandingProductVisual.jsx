import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Coffee,
  LayoutDashboard,
  Scissors,
  Settings2,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'

// Vistas ilustrativas del producto que usa cada negocio. El CRM comercial es
// una herramienta interna de la plataforma y no se presenta a los clientes.
export const PRODUCT_VIEWS = [
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'booking', label: 'Reserva online', icon: CalendarCheck },
  { id: 'management', label: 'Gestión', icon: LayoutDashboard },
]

export function ProductPreview({ mode }) {
  if (mode === 'booking') {
    return (
      <div className="marketing-preview marketing-preview-booking" role="img" aria-label="Ejemplo de la página de reserva online: el cliente elige servicio, fecha y hora">
        <div className="marketing-preview-header"><span className="marketing-preview-dot" /><div><strong>Barbería Central</strong><small>Elegí tu próximo turno</small></div><span className="marketing-preview-live">Online</span></div>
        <div className="marketing-booking-progress"><span className="is-active">1 · Servicio</span><span>2 · Fecha y hora</span><span>3 · Tus datos</span></div>
        <div className="marketing-booking-card"><small>Servicio</small><div className="marketing-booking-option is-selected"><span><strong>Corte clásico</strong><small>30 min · ARS 15.000</small></span><CheckCircle2 size={18} /></div><div className="marketing-booking-option"><span><strong>Barba</strong><small>30 min · ARS 10.000</small></span><span className="marketing-option-check" /></div></div>
        <div className="marketing-booking-footer"><span><Clock3 size={14} /> Disponibilidad actualizada</span><span className="marketing-booking-next">Continuar <ArrowRight size={14} /></span></div>
      </div>
    )
  }

  if (mode === 'management') {
    return (
      <div className="marketing-preview marketing-preview-management" role="img" aria-label="Ejemplo del panel de gestión con clientes, servicios, horarios y configuración">
        <div className="marketing-preview-header"><span className="marketing-preview-dot" /><div><strong>Panel del negocio</strong><small>Todo en un solo lugar</small></div><span className="marketing-preview-avatar">B</span></div>
        <div className="marketing-management-grid"><article><UsersRound size={17} /><small>Clientes</small><strong>Ficha e historial</strong><span>Consultá la información cuando la necesitás.</span></article><article><Scissors size={17} /><small>Servicios</small><strong>Duración y precio</strong><span>Ordená tu catálogo y disponibilidad.</span></article><article><CalendarDays size={17} /><small>Horarios</small><strong>Jornadas y pausas</strong><span>La agenda respeta tu forma de trabajar.</span></article><article><Settings2 size={17} /><small>Configuración</small><strong>Marca y reservas</strong><span>Ajustes agrupados para administrar mejor.</span></article></div>
      </div>
    )
  }

  return (
    <div className="marketing-preview marketing-preview-agenda" role="img" aria-label="Ejemplo de la agenda del día con turnos y una pausa">
      <div className="marketing-preview-header"><span className="marketing-preview-dot" /><div><strong>Agenda</strong><small>Miércoles · vista del día</small></div><span className="marketing-preview-date">Hoy</span></div>
      <div className="marketing-agenda-layout">
        <div className="marketing-agenda-times"><span>09:00</span><span>10:00</span><span>11:00</span><span>12:00</span><span>13:00</span></div>
        <div className="marketing-agenda-track">
          <span className="marketing-agenda-line line-1" /><span className="marketing-agenda-line line-2" /><span className="marketing-agenda-line line-3" /><span className="marketing-agenda-line line-4" /><span className="marketing-agenda-line line-5" />
          <article className="marketing-turno turno-one"><strong>Martín · Corte y barba</strong><small>09:30 · 45 min</small></article>
          <article className="marketing-turno turno-two"><strong>Lucía · Corte clásico</strong><small>11:00 · 45 min</small></article>
          <div className="marketing-break"><Coffee size={13} /> Pausa · 12:30</div>
        </div>
      </div>
      <div className="marketing-preview-legend"><span><i className="legend-dot is-booked" /> Turnos</span><span><i className="legend-dot is-break" /> Pausas</span><span><i className="legend-dot is-free" /> Disponibilidad</span></div>
    </div>
  )
}

export function ProductVisual({ mode, onChange }) {
  return (
    <div className="marketing-product-visual">
      <div className="marketing-product-tabs" role="group" aria-label="Vistas del producto">
        {PRODUCT_VIEWS.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={mode === id} className={mode === id ? 'is-active' : ''} onClick={() => onChange(id)}><Icon size={15} aria-hidden="true" /> {label}</button>)}
      </div>
      <ProductPreview mode={mode} />
      <p className="marketing-product-note"><ShieldCheck size={14} aria-hidden="true" /> Vista ilustrativa del producto. Los datos son de ejemplo.</p>
    </div>
  )
}
