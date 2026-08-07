import { useMemo, useState } from 'react'
import { CalendarDays, Check, RotateCcw, Scissors, Sparkles } from 'lucide-react'

const VERTICALS = [
  { id: 'barberia', label: 'Barbería', services: ['Corte clásico', 'Barba', 'Combo corte + barba'] },
  { id: 'peluqueria', label: 'Peluquería', services: ['Corte', 'Color', 'Brushing'] },
  { id: 'estetica', label: 'Centro de estética', services: ['Limpieza facial', 'Masaje', 'Depilación'] },
  { id: 'tattoo', label: 'Tattoo', services: ['Consulta', 'Sesión corta', 'Sesión larga'] },
  { id: 'custom', label: 'Otro rubro', services: ['Servicio inicial', 'Consulta', 'Seguimiento'] },
]

const demoKey = 'austral-demo-session'

export default function DemoWorkspace() {
  const [vertical, setVertical] = useState(() => sessionStorage.getItem(demoKey) || 'barberia')
  const [brand, setBrand] = useState('#9b6a2f')
  const [selected, setSelected] = useState(0)
  const [booked, setBooked] = useState(false)
  const profile = useMemo(() => VERTICALS.find((item) => item.id === vertical) || VERTICALS[0], [vertical])

  const changeVertical = (value) => { setVertical(value); sessionStorage.setItem(demoKey, value); setSelected(0); setBooked(false) }
  const reset = () => { sessionStorage.removeItem(demoKey); setVertical('barberia'); setBrand('#9b6a2f'); setSelected(0); setBooked(false) }

  return <main className="demo-shell" style={{ '--demo-accent': brand }}>
    <header className="demo-header"><div className="demo-brand"><span><Scissors size={18} /></span><div><strong>Demo aislada</strong><small>No usa tenants productivos</small></div></div><button className="btn" onClick={reset}><RotateCcw size={14} /> Reiniciar demo</button></header>
    <section className="demo-hero"><div><p className="page-kicker">Austral SaaS · modo demostración</p><h1>Mostrá una operación completa en menos de cinco minutos.</h1><p>Esta sesión vive sólo en tu navegador. Los servicios, el branding y la reserva son ficticios y se eliminan al reiniciar.</p></div><div className="demo-controls panel"><label>Vertical<select className="text-input" value={vertical} onChange={(event) => changeVertical(event.target.value)}>{VERTICALS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Color de marca<input type="color" value={brand} onChange={(event) => setBrand(event.target.value)} /></label></div></section>
    <section className="demo-grid"><div className="panel"><div className="panel-header-inline"><div><h2 className="panel-title"><Sparkles size={16} /> {profile.label}</h2><p className="panel-subtitle">Servicios ficticios para la demo.</p></div><span className="status-pill">Sandbox local</span></div><div className="demo-services">{profile.services.map((service, index) => <button key={service} className={selected === index ? 'selected' : ''} onClick={() => { setSelected(index); setBooked(false) }}><strong>{service}</strong><small>{30 + index * 15} min · USD {15 + index * 5}</small></button>)}</div></div><div className="panel demo-booking"><h2 className="panel-title"><CalendarDays size={16} /> Reserva ficticia</h2><p className="panel-subtitle">No se escribe en Supabase ni se envía ningún mensaje.</p>{booked ? <div className="demo-success" role="status"><Check size={22} /><strong>Reserva de prueba creada</strong><span>{profile.services[selected]} · mañana 10:00</span></div> : <><label>Nombre de prueba<input className="text-input" defaultValue="Cliente Demo" /></label><button className="btn btn-primary" onClick={() => setBooked(true)}>Reservar en sandbox</button></>}</div></section>
    <footer className="demo-footer">Sesión temporal: {sessionStorage.getItem(demoKey) || 'barberia'} · Datos aislados por visitante · Sin integraciones externas</footer>
  </main>
}
