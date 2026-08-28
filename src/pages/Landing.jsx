import { useEffect, useMemo, useState } from 'react'
import '../components/landing.css'
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  MessageCircle,
  Moon,
  Scissors,
  Settings2,
  ShieldCheck,
  Sun,
  UsersRound,
} from 'lucide-react'
import { getLocale, t } from '../lib/i18n'
import { getVerticalProfile, normalizeVertical } from '../lib/tenant'
import { ProductPreview } from '../components/LandingProductVisual.jsx'
import { COMMERCIAL_CATALOG, getSalesWhatsAppHref } from '../lib/commercialCatalog'

const FEATURE_GROUPS = [
  {
    eyebrow: 'Operación diaria',
    title: 'Una agenda que refleja tu negocio',
    text: 'Horarios laborales, breaks, bloqueos, profesionales y duración de servicios en un mismo lugar.',
    items: [
      { icon: CalendarDays, title: 'Agenda', text: 'Leé el día y la semana con turnos, disponibilidad y pausas visibles.' },
      { icon: Clock3, title: 'Horarios', text: 'Configurá jornadas y descansos para que la disponibilidad sea real.' },
      { icon: Scissors, title: 'Servicios', text: 'Definí duración, precio y qué profesional puede realizar cada servicio.' },
    ],
  },
  {
    eyebrow: 'Relación con clientes',
    title: 'Menos información dispersa',
    text: 'Todo lo que el equipo necesita para atender y organizar reservas desde el panel.',
    items: [
      { icon: CalendarCheck, title: 'Reservas online', text: 'Compartí una página pública para que el cliente elija servicio, profesional, fecha y hora.' },
      { icon: UsersRound, title: 'Clientes', text: 'Consultá datos e historial en una ficha centralizada.' },
      { icon: Settings2, title: 'Configuración', text: 'Ajustá branding, contacto, reservas, región y colaboradores.' },
    ],
  },
]

const FAQ_ITEMS = [
  ['¿Necesito instalar algo?', 'No. Austral funciona desde el navegador y puede usarse desde una computadora o un celular con acceso a internet.'],
  ['¿Funciona desde el celular?', 'Sí. La reserva pública y el panel están preparados para pantallas móviles, además de escritorio.'],
  ['¿Puedo gestionar varios empleados?', 'Sí. Podés cargar profesionales, sus servicios y sus horarios de trabajo sin crear empleados ficticios.'],
  ['¿Cómo funcionan las reservas?', 'El cliente elige servicio, profesional, fecha y horario. La disponibilidad se consulta nuevamente al confirmar para evitar superposiciones.'],
  ['¿Qué ocurre durante el trial?', 'El onboarding inicia una prueba gratuita de 14 días y crea la configuración mínima para comenzar.'],
  ['¿Cómo funciona WhatsApp?', 'La conexión se configura aparte y puede requerir pasos técnicos adicionales. La reserva pública funciona de manera independiente; no se activa una automatización productiva sin configuración.'],
  ['¿Puedo cancelar?', 'Podés revisar y gestionar el estado de tu suscripción desde el panel. Las condiciones concretas dependen del plan y proveedor habilitado.'],
  ['¿Qué medios de pago existen?', 'Los medios disponibles dependen del proveedor configurado para tu cuenta. La landing no muestra opciones que no estén habilitadas en el catálogo.'],
]

function upsertMeta(attribute, value, content) {
  if (!content) return
  let element = document.head.querySelector(`meta[${attribute}="${value}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, value)
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
}

function upsertCanonical(href) {
  let link = document.head.querySelector('link[rel="canonical"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'canonical'
    document.head.appendChild(link)
  }
  link.href = href
}

function WhatsAppFlow() {
  const steps = [
    ['Cliente', UsersRound],
    ['WhatsApp', MessageCircle],
    ['Disponibilidad', Clock3],
    ['Reserva', CalendarCheck],
    ['Agenda', CalendarDays],
  ]
  return <div className="marketing-whatsapp-flow" aria-label="Flujo conceptual desde WhatsApp hasta la Agenda">{steps.map(([label, Icon], index) => <div className="marketing-flow-step" key={label}><span><Icon size={20} /></span><strong>{label}</strong>{index < steps.length - 1 && <ArrowRight className="marketing-flow-arrow" size={17} aria-hidden="true" />}</div>)}</div>
}

function planFeatures(plan) {
  const configured = Array.isArray(plan.funcionalidades) ? plan.funcionalidades.filter(Boolean) : []
  if (configured.length) return configured.slice(0, 4).map((item) => typeof item === 'string' ? item : item.nombre || item.label).filter(Boolean)
  return ['Agenda y reservas públicas', 'Clientes, servicios y horarios', `Prueba de ${plan.trial_dias || 14} días`]
}

function formatPlanPrice(plan, locale) {
  const amount = Number(plan.precio_mensual)
  if (!Number.isFinite(amount) || amount === 0) return 'Personalizado'
  const currency = String(plan.moneda || 'ARS').toUpperCase()
  return `${currency} ${amount.toLocaleString(locale, { maximumFractionDigits: 2 })}`
}

export default function Landing({ vertical = 'custom' }) {
  const locale = getLocale()
  const normalizedVertical = normalizeVertical(vertical)
  const profile = useMemo(() => getVerticalProfile(normalizedVertical), [normalizedVertical])
  const [plans] = useState(COMMERCIAL_CATALOG)
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('austral-public-theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch { /* storage is optional */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    const previousTheme = document.documentElement.getAttribute('data-theme')
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('austral-public-theme', theme) } catch { /* storage is optional */ }
    return () => {
      if (previousTheme) document.documentElement.setAttribute('data-theme', previousTheme)
      else document.documentElement.removeAttribute('data-theme')
    }
  }, [theme])

  useEffect(() => {
    const title = `${profile.label} · ${t('product', locale)}`
    const description = profile.label === 'Barbería'
      ? 'Gestioná turnos, agenda, clientes, empleados y reservas online para tu barbería.'
      : `Gestioná reservas, clientes, equipo y servicios para tu ${profile.label.toLowerCase()}.`
    const path = normalizedVertical === 'custom' ? '/' : `/para/${normalizedVertical}`
    document.title = title
    upsertMeta('name', 'description', description)
    upsertMeta('property', 'og:title', title)
    upsertMeta('property', 'og:description', description)
    upsertMeta('property', 'og:url', `${window.location.origin}${path}`)
    upsertMeta('name', 'twitter:title', title)
    upsertMeta('name', 'twitter:description', description)
    upsertCanonical(`${window.location.origin}${path}`)
  }, [locale, normalizedVertical, profile.label])

  const productLabel = profile.label === 'Barbería' ? 'barberías' : profile.label.toLowerCase()

  return (
    <main className="marketing-sections">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: t('product', locale), applicationCategory: 'BusinessApplication', operatingSystem: 'Web', description: `Gestión de reservas y operación para ${productLabel}.` }) }} />

      <section className="marketing-proof-strip" aria-label="Qué podés centralizar"><div className="marketing-container marketing-proof-items"><span><CalendarCheck size={17} /> Turnos</span><span><UsersRound size={17} /> Clientes</span><span><Scissors size={17} /> Servicios</span><span><Clock3 size={17} /> Horarios</span><span><MessageCircle size={17} /> WhatsApp en validación</span></div></section>

      <section className="marketing-section marketing-problem-section"><div className="marketing-container marketing-split-heading"><div><span className="marketing-kicker">El problema cotidiano</span><h2>Cuando la agenda vive en chats, cada decisión cuesta atención.</h2></div><p>Austral ordena la información que tu equipo necesita para responder, reservar y trabajar con menos idas y vueltas.</p></div><div className="marketing-problem-grid marketing-container"><article><MessageCircle size={19} /><h3>Responder lo mismo una y otra vez</h3><p>La reserva pública ayuda a que el cliente encuentre datos y horarios sin depender de una conversación manual.</p></article><article><CalendarDays size={19} /><h3>Organizar turnos a mano</h3><p>La agenda muestra profesionales, turnos, breaks y bloqueos en el contexto del día.</p></article><article><UsersRound size={19} /><h3>Tener la información dispersa</h3><p>Clientes, servicios, equipo y configuración viven en un mismo workspace.</p></article></div></section>

      <section id="funciones" className="marketing-section marketing-feature-section"><div className="marketing-container"><div className="marketing-section-heading"><span className="marketing-kicker">Una base para operar mejor</span><h2>Lo esencial, conectado.</h2><p>Empezá con lo que necesitás hoy y sumá automatizaciones cuando tu operación esté preparada.</p></div>{FEATURE_GROUPS.map((group) => <div className="marketing-feature-group" key={group.title}><div className="marketing-feature-group-heading"><span>{group.eyebrow}</span><h3>{group.title}</h3><p>{group.text}</p></div><div className="marketing-feature-grid">{group.items.map(({ icon: Icon, title, text: description }) => <article key={title}><span className="marketing-feature-icon"><Icon size={19} /></span><h4>{title}</h4><p>{description}</p></article>)}</div></div>)}</div></section>

      <section className="marketing-section marketing-whatsapp-section"><div className="marketing-container marketing-split-heading"><div><span className="marketing-kicker">WhatsApp, con control</span><h2>Integración preparada para validar antes de activar.</h2></div><p>La reserva pública ya puede funcionar por sí sola. El flujo de WhatsApp se muestra como referencia operativa: requiere configuración, validación y autorización antes de cualquier automatización productiva.</p></div><div className="marketing-container"><WhatsAppFlow /><p className="marketing-safety-note"><ShieldCheck size={16} /> Disponible próximamente según configuración del negocio. Esta landing no envía mensajes ni activa automatizaciones.</p></div></section>

      <section id="como-funciona" className="marketing-section marketing-steps-section"><div className="marketing-container"><div className="marketing-section-heading"><span className="marketing-kicker">Cómo funciona</span><h2>De la cuenta a la primera reserva, sin pasos innecesarios.</h2></div><div className="marketing-steps-grid"><article><span>01</span><h3>Creás tu cuenta</h3><p>Nombre, email y contraseña. Verificás tu correo para continuar.</p></article><article><span>02</span><h3>Configurás el negocio</h3><p>Elegís rubro, país, idioma, zona horaria, moneda y marca.</p></article><article><span>03</span><h3>Cargás equipo y servicios</h3><p>Definís profesionales, jornadas, breaks, servicios y duración.</p></article><article><span>04</span><h3>Compartís tus reservas</h3><p>Publicás el enlace y gestionás cada turno desde Austral.</p></article></div></div></section>

      <section className="marketing-section marketing-product-section"><div className="marketing-container marketing-product-story"><div className="marketing-product-story-copy"><span className="marketing-kicker">Reserva pública</span><h2>Una experiencia clara para quien reserva.</h2><p>El cliente selecciona servicio, profesional, fecha y horario. Antes de confirmar, el sistema vuelve a comprobar que el turno siga disponible.</p><ul><li><Check size={16} /> Mobile-first</li><li><Check size={16} /> Duración por servicio y profesional</li><li><Check size={16} /> Confirmación con datos claros</li></ul><a className="marketing-text-link" href="/demo">Ver la demo aislada <ArrowRight size={15} /></a></div><ProductPreview mode="booking" /></div></section>

      <section className="marketing-section marketing-dark-section"><div className="marketing-container marketing-product-story reverse"><ProductPreview mode="agenda" /><div className="marketing-product-story-copy"><span className="marketing-kicker">Agenda operativa</span><h2>La disponibilidad se entiende de un vistazo.</h2><p>Turnos, profesionales, breaks y bloqueos aparecen juntos para que el equipo pueda decidir con contexto.</p><ul><li><Check size={16} /> Vista de día y semana</li><li><Check size={16} /> Horarios de cada profesional</li><li><Check size={16} /> Estados y acciones visibles</li></ul></div></div></section>

      <section className="marketing-section marketing-management-section"><div className="marketing-container marketing-product-story"><div className="marketing-product-story-copy"><span className="marketing-kicker">Gestión centralizada</span><h2>Clientes, servicios, empleados y configuración, sin saltar entre herramientas.</h2><p>El workspace reúne la operación diaria y conserva la información necesaria para atender mejor.</p><a className="marketing-text-link" href="/registro">Empezar a configurar <ArrowRight size={15} /></a></div><ProductPreview mode="management" /></div></section>

      <section className="marketing-section marketing-crm-section"><div className="marketing-container marketing-product-story reverse"><ProductPreview mode="crm" /><div className="marketing-product-story-copy"><span className="marketing-kicker">Seguimiento comercial</span><h2>Cuando el negocio crece, también necesitás ordenar las oportunidades.</h2><p>El CRM de plataforma organiza negocios, leads, etapas y próximas acciones sin mezclarlo con la operación diaria.</p></div></div></section>

      <section id="planes" className="marketing-section marketing-pricing-section"><div className="marketing-container"><div className="marketing-section-heading"><span className="marketing-kicker">Planes</span><h2>Elegí el punto de partida de tu operación.</h2><p>Precios vigentes en pesos argentinos. Mercado Pago está pausado: podés crear tu cuenta o consultar con el equipo.</p></div><div className="marketing-plan-grid">{plans.map((plan) => { const salesHref = getSalesWhatsAppHref(plan); return <article className="marketing-plan-card" key={plan.codigo}><div className="marketing-plan-card-heading"><div><span className="marketing-plan-code">{plan.codigo}</span><h3>{plan.nombre}</h3></div><span className="marketing-plan-trial">{plan.trial_dias || 14} días de prueba</span></div><p className="marketing-plan-description">{plan.descripcion}</p><strong className="marketing-plan-price">{formatPlanPrice(plan, locale)}<small> / mes</small></strong><ul>{planFeatures(plan).map((feature) => <li key={feature}><Check size={15} /> {feature}</li>)}</ul><div className="marketing-plan-actions"><a className="marketing-button secondary" href="/registro">Empezar con {plan.nombre} <ArrowRight size={15} /></a>{salesHref && <a className="marketing-text-link" href={salesHref} target="_blank" rel="noreferrer">Consultar por WhatsApp <MessageCircle size={15} /></a>}</div></article> })}</div><p className="marketing-pricing-note"><ShieldCheck size={15} /> El trial se inicia al completar el onboarding. El pago se habilitará cuando el proveedor esté listo.</p></div></section>

      <section id="faq" className="marketing-section marketing-faq-section"><div className="marketing-container marketing-faq-layout"><div className="marketing-section-heading"><span className="marketing-kicker">Preguntas frecuentes</span><h2>Antes de empezar, lo importante.</h2><p>Respuestas basadas en el flujo actual de Austral.</p></div><div className="marketing-faq-list">{FAQ_ITEMS.map(([question, answer], index) => <details key={question} open={index === 0}><summary>{question}<ChevronDown size={17} /></summary><p>{answer}</p></details>)}</div></div></section>

      <section className="marketing-final-cta"><div className="marketing-container"><span className="marketing-kicker">Listo para ordenar tu operación</span><h2>Probá Austral con tu propio negocio.</h2><p>Configurá lo esencial, compartí tus reservas y evaluá si el flujo encaja con tu forma de trabajar.</p><div className="marketing-actions"><a className="marketing-button primary" href="/registro">Crear mi cuenta <ArrowRight size={17} /></a><a className="marketing-button secondary" href="/ingresar">Ya tengo una cuenta</a></div></div></section>

      <footer className="marketing-footer"><div className="marketing-container marketing-footer-inner"><div><a className="marketing-brand" href="/"><span className="marketing-brand-mark">A</span><span><strong>Austral</strong><small>Automatizaciones</small></span></a><p>Gestión de reservas y operación para negocios de servicios.</p></div><div className="marketing-footer-links"><a href="#producto">Producto</a><a href="#funciones">Funciones</a><a href="#planes">Planes</a><a href="#faq">FAQ</a><a href="/ingresar">Ingresar</a></div><div className="marketing-footer-controls"><button type="button" className="marketing-theme-toggle" aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'} onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}<span>{theme === 'dark' ? 'Claro' : 'Oscuro'}</span></button></div></div><div className="marketing-container marketing-footer-bottom"><span>© {new Date().getFullYear()} Austral Automatizaciones</span><span>La conexión de WhatsApp puede requerir configuración adicional.</span></div></footer>
    </main>
  )
}
