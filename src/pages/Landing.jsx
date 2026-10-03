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
import { t } from '../lib/i18n'
import { getVerticalProfile, normalizeVertical } from '../lib/tenant'
import { ProductPreview } from '../components/LandingProductVisual.jsx'
import { COMMERCIAL_CATALOG, COMMERCIAL_TRIAL_DAYS, getSalesWhatsAppHref } from '../lib/commercialCatalog'

const FEATURE_GROUPS = [
  {
    eyebrow: 'Operación diaria',
    title: 'Una agenda que refleja tu negocio',
    text: 'Horarios laborales, pausas, bloqueos, profesionales y duración de servicios en un mismo lugar.',
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
      { icon: Settings2, title: 'Configuración', text: 'Ajustá tu marca, datos de contacto, reservas, región y colaboradores.' },
    ],
  },
]

const FAQ_ITEMS = [
  ['¿Necesito instalar algo?', 'No. Austral funciona desde el navegador y puede usarse desde una computadora o un celular con acceso a internet.'],
  ['¿Funciona desde el celular?', 'Sí. La reserva online y el panel están pensados para el celular, y también funcionan en la computadora.'],
  ['¿Puedo gestionar varios empleados?', 'Sí. Podés cargar profesionales, sus servicios y sus horarios de trabajo sin crear empleados ficticios.'],
  ['¿Cómo funcionan las reservas?', 'El cliente elige servicio, profesional, fecha y horario. Al confirmar, la disponibilidad se vuelve a consultar para evitar turnos superpuestos.'],
  ['¿Cómo funciona la prueba gratuita?', `Cuando terminás la configuración inicial empieza una prueba gratuita de ${COMMERCIAL_TRIAL_DAYS} días, sin tarjeta. Sólo se crea lo mínimo para empezar: no cargamos datos ficticios.`],
  ['¿Cómo funciona WhatsApp?', 'La integración con WhatsApp se configura y se valida con cada negocio antes de activarse. La reserva online funciona por su cuenta desde el primer día, sin depender de WhatsApp.'],
  ['¿Puedo cancelar?', 'Sí. Desde el panel ves el estado de tu suscripción y el pago es mensual: lo coordinás directamente con el equipo de Austral por WhatsApp.'],
  ['¿Qué medios de pago existen?', 'Por ahora el pago mensual se coordina por WhatsApp con el equipo de Austral, que te indica los medios disponibles. Para la prueba no te pedimos tarjeta.'],
]

// Capacidades reales del producto que acompañan a las funcionalidades del
// catálogo comercial (que sigue siendo la fuente de precio y prueba).
const PLAN_HIGHLIGHTS = ['Equipo con horarios y pausas por profesional', 'Página de reservas con tu marca', 'Panel desde el celular o la compu']

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
  return (
    <ol className="marketing-whatsapp-flow" aria-label="Recorrido de una reserva desde WhatsApp hasta la agenda">
      {steps.map(([label, Icon], index) => (
        <li className="marketing-flow-step" key={label}>
          <span aria-hidden="true"><Icon size={20} /></span>
          <strong>{label}</strong>
          {index < steps.length - 1 && <ArrowRight className="marketing-flow-arrow" size={17} aria-hidden="true" />}
        </li>
      ))}
    </ol>
  )
}

function planFeatures(plan) {
  const configured = Array.isArray(plan.funcionalidades) ? plan.funcionalidades.filter(Boolean) : []
  const base = configured.length
    ? configured.slice(0, 4).map((item) => typeof item === 'string' ? item : item.nombre || item.label).filter(Boolean)
    : ['Agenda y reservas públicas', 'Clientes, servicios y horarios', `Prueba de ${plan.trial_dias || COMMERCIAL_TRIAL_DAYS} días`]
  return [...new Set([...base, ...PLAN_HIGHLIGHTS])].slice(0, 6)
}

function formatPlanPrice(plan, locale) {
  const amount = Number(plan.precio_mensual)
  if (!Number.isFinite(amount) || amount === 0) return 'Personalizado'
  const currency = String(plan.moneda || 'ARS').toUpperCase()
  return `${currency} ${amount.toLocaleString(locale === 'es' ? 'es-AR' : locale, { maximumFractionDigits: 2 })}`
}

export default function Landing({ vertical = 'custom' }) {
  // La landing está escrita en español: el título y el precio no dependen del
  // idioma del navegador (en inglés se veía "ARS 50,000" junto a "ARS 50.000").
  const locale = 'es'
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

      <section className="marketing-proof-strip" aria-label="Qué podés centralizar">
        <ul className="marketing-container marketing-proof-items">
          <li><CalendarCheck size={17} aria-hidden="true" /> Turnos</li>
          <li><UsersRound size={17} aria-hidden="true" /> Clientes</li>
          <li><Scissors size={17} aria-hidden="true" /> Servicios</li>
          <li><Clock3 size={17} aria-hidden="true" /> Horarios</li>
          <li><MessageCircle size={17} aria-hidden="true" /> WhatsApp, próximamente</li>
        </ul>
      </section>

      <section className="marketing-section marketing-problem-section" aria-labelledby="marketing-problem-title">
        <div className="marketing-container marketing-split-heading">
          <div><span className="marketing-kicker">El problema cotidiano</span><h2 id="marketing-problem-title">Cuando la agenda vive en chats, cada decisión cuesta atención.</h2></div>
          <p>Austral ordena la información que tu equipo necesita para responder, reservar y trabajar con menos idas y vueltas.</p>
        </div>
        <div className="marketing-problem-grid marketing-container">
          <article><MessageCircle size={19} aria-hidden="true" /><h3>Responder lo mismo una y otra vez</h3><p>La reserva online ayuda a que el cliente encuentre servicios y horarios sin depender de una conversación manual.</p></article>
          <article><CalendarDays size={19} aria-hidden="true" /><h3>Organizar turnos a mano</h3><p>La agenda muestra profesionales, turnos, pausas y bloqueos en el contexto del día.</p></article>
          <article><UsersRound size={19} aria-hidden="true" /><h3>Tener la información dispersa</h3><p>Clientes, servicios, equipo y configuración viven en un mismo panel.</p></article>
        </div>
      </section>

      <section id="funciones" className="marketing-section marketing-feature-section" aria-labelledby="marketing-features-title">
        <div className="marketing-container">
          <div className="marketing-section-heading"><span className="marketing-kicker">Una base para operar mejor</span><h2 id="marketing-features-title">Lo esencial, conectado.</h2><p>Empezá con lo que necesitás hoy y sumá automatizaciones cuando tu operación esté preparada.</p></div>
          {FEATURE_GROUPS.map((group) => (
            <div className="marketing-feature-group" key={group.title}>
              <div className="marketing-feature-group-heading"><span>{group.eyebrow}</span><h3>{group.title}</h3><p>{group.text}</p></div>
              <div className="marketing-feature-grid">
                {group.items.map(({ icon: Icon, title, text: description }) => <article key={title}><span className="marketing-feature-icon" aria-hidden="true"><Icon size={19} /></span><h4>{title}</h4><p>{description}</p></article>)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="marketing-section marketing-whatsapp-section" aria-labelledby="marketing-whatsapp-title">
        <div className="marketing-container marketing-split-heading">
          <div><span className="marketing-kicker">WhatsApp, con control</span><h2 id="marketing-whatsapp-title">Una integración que se activa cuando está lista.</h2></div>
          <p>La reserva online funciona desde el primer día, sin depender de WhatsApp. La integración se configura y se valida con cada negocio antes de activar cualquier respuesta automática.</p>
        </div>
        <div className="marketing-container">
          <WhatsAppFlow />
          <p className="marketing-safety-note"><ShieldCheck size={16} aria-hidden="true" /> <span>Disponible próximamente. La activamos junto con cada negocio, después de configurarla y probarla.</span></p>
        </div>
      </section>

      <section id="como-funciona" className="marketing-section marketing-steps-section" aria-labelledby="marketing-steps-title">
        <div className="marketing-container">
          <div className="marketing-section-heading"><span className="marketing-kicker">Cómo funciona</span><h2 id="marketing-steps-title">De la cuenta a la primera reserva, sin pasos innecesarios.</h2></div>
          <ol className="marketing-steps-grid">
            <li><span aria-hidden="true">01</span><h3>Creás tu cuenta</h3><p>Nombre, email y contraseña. Verificás tu correo para continuar.</p></li>
            <li><span aria-hidden="true">02</span><h3>Configurás el negocio</h3><p>Elegís rubro, país, idioma, zona horaria, moneda y marca.</p></li>
            <li><span aria-hidden="true">03</span><h3>Cargás equipo y servicios</h3><p>Definís profesionales, jornadas, pausas, servicios y duración.</p></li>
            <li><span aria-hidden="true">04</span><h3>Compartís tus reservas</h3><p>Publicás el enlace y gestionás cada turno desde Austral.</p></li>
          </ol>
        </div>
      </section>

      <section className="marketing-section marketing-product-section" aria-labelledby="marketing-booking-title">
        <div className="marketing-container marketing-product-story">
          <div className="marketing-product-story-copy">
            <span className="marketing-kicker">Reserva online</span>
            <h2 id="marketing-booking-title">Una experiencia clara para quien reserva.</h2>
            <p>El cliente selecciona servicio, profesional, fecha y horario. Antes de confirmar, el sistema vuelve a comprobar que el turno siga disponible.</p>
            <ul><li><Check size={16} aria-hidden="true" /> Pensada para el celular</li><li><Check size={16} aria-hidden="true" /> Duración por servicio y profesional</li><li><Check size={16} aria-hidden="true" /> Confirmación con datos claros</li></ul>
            <a className="marketing-text-link" href="/demo">Probar la demo <ArrowRight size={15} aria-hidden="true" /></a>
          </div>
          <ProductPreview mode="booking" />
        </div>
      </section>

      <section className="marketing-section marketing-dark-section" aria-labelledby="marketing-agenda-title">
        <div className="marketing-container marketing-product-story reverse">
          <ProductPreview mode="agenda" />
          <div className="marketing-product-story-copy">
            <span className="marketing-kicker">Agenda operativa</span>
            <h2 id="marketing-agenda-title">La disponibilidad se entiende de un vistazo.</h2>
            <p>Turnos, profesionales, pausas y bloqueos aparecen juntos para que el equipo pueda decidir con contexto.</p>
            <ul><li><Check size={16} aria-hidden="true" /> Vista de día y semana</li><li><Check size={16} aria-hidden="true" /> Horarios de cada profesional</li><li><Check size={16} aria-hidden="true" /> Estados y acciones visibles</li></ul>
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-management-section" aria-labelledby="marketing-management-title">
        <div className="marketing-container marketing-product-story">
          <div className="marketing-product-story-copy">
            <span className="marketing-kicker">Gestión centralizada</span>
            <h2 id="marketing-management-title">Clientes, servicios y equipo, sin saltar entre herramientas.</h2>
            <p>El panel reúne la operación diaria y conserva la información necesaria para atender mejor.</p>
            <a className="marketing-text-link" href="/registro">Empezar a configurar <ArrowRight size={15} aria-hidden="true" /></a>
          </div>
          <ProductPreview mode="management" />
        </div>
      </section>

      <section id="planes" className="marketing-section marketing-pricing-section" aria-labelledby="marketing-pricing-title">
        <div className="marketing-container">
          <div className="marketing-section-heading">
            <span className="marketing-kicker">Un solo plan</span>
            <h2 id="marketing-pricing-title">Austral para ordenar tu operación.</h2>
            <p>ARS 50.000 por mes, con 15 días gratis para probar el flujo completo. Sin tarjeta para empezar: al terminar la prueba coordinamos el pago con vos.</p>
          </div>
          <div className="marketing-plan-grid">
            {plans.map((plan) => {
              const salesHref = getSalesWhatsAppHref(plan)
              const trialDays = plan.trial_dias || COMMERCIAL_TRIAL_DAYS
              return (
                <article className="marketing-plan-card" key={plan.codigo}>
                  <div className="marketing-plan-main">
                    <div className="marketing-plan-card-heading">
                      <div><span className="marketing-plan-code">Plan único</span><h3>{plan.nombre}</h3></div>
                      <span className="marketing-plan-trial">{trialDays} días de prueba</span>
                    </div>
                    <p className="marketing-plan-description">{plan.descripcion}</p>
                    <strong className="marketing-plan-price">{formatPlanPrice(plan, locale)}<small> / mes</small></strong>
                    <div className="marketing-plan-actions">
                      <a className="marketing-button primary" href="/registro">Probar gratis 15 días <ArrowRight size={15} aria-hidden="true" /></a>
                      {salesHref && <a className="marketing-text-link" href={salesHref} target="_blank" rel="noreferrer">Consultar por WhatsApp <MessageCircle size={15} aria-hidden="true" /></a>}
                    </div>
                  </div>
                  <div className="marketing-plan-includes">
                    <span className="marketing-plan-includes-title">Incluye</span>
                    <ul>{planFeatures(plan).map((feature) => <li key={feature}><Check size={15} aria-hidden="true" /> {feature}</li>)}</ul>
                  </div>
                </article>
              )
            })}
          </div>
          <p className="marketing-pricing-note marketing-pricing-note--branches">¿Tenés más de una sucursal? Lo vemos según tu caso.</p>
          <p className="marketing-pricing-note"><ShieldCheck size={15} aria-hidden="true" /> <span>La prueba arranca al terminar la configuración. Después, coordinamos el pago por WhatsApp.</span></p>
        </div>
      </section>

      <section id="faq" className="marketing-section marketing-faq-section" aria-labelledby="marketing-faq-title">
        <div className="marketing-container marketing-faq-layout">
          <div className="marketing-section-heading"><span className="marketing-kicker">Preguntas frecuentes</span><h2 id="marketing-faq-title">Antes de empezar, lo importante.</h2><p>Respuestas basadas en el funcionamiento actual de Austral.</p></div>
          <div className="marketing-faq-list">
            {FAQ_ITEMS.map(([question, answer], index) => <details key={question} open={index === 0}><summary>{question}<ChevronDown size={17} aria-hidden="true" /></summary><p>{answer}</p></details>)}
          </div>
        </div>
      </section>

      <section className="marketing-final-cta" aria-labelledby="marketing-final-title">
        <div className="marketing-container">
          <span className="marketing-kicker">Listo para ordenar tu operación</span>
          <h2 id="marketing-final-title">Probá Austral con tu propio negocio.</h2>
          <p>Configurá lo esencial, compartí tus reservas y evaluá si el flujo encaja con tu forma de trabajar.</p>
          <div className="marketing-actions"><a className="marketing-button primary" href="/registro">Crear mi cuenta <ArrowRight size={17} aria-hidden="true" /></a><a className="marketing-button secondary" href="/ingresar">Ya tengo una cuenta</a></div>
        </div>
      </section>

      <footer className="marketing-footer">
        <div className="marketing-container marketing-footer-inner">
          <div>
            <a className="marketing-brand" href="/"><span className="marketing-brand-mark" aria-hidden="true">A</span><span><strong>Austral</strong><small>Automatizaciones</small></span></a>
            <p>Gestión de turnos, reservas y operación para negocios de servicios.</p>
          </div>
          <nav className="marketing-footer-links" aria-label="Enlaces del pie de página">
            <a href="#funciones">Funciones</a><a href="#como-funciona">Cómo funciona</a><a href="#planes">Planes</a><a href="#faq">Preguntas frecuentes</a><a href="/demo">Ver demo</a><a href="/ingresar">Ingresar</a>
          </nav>
          <div className="marketing-footer-controls">
            <button type="button" className="marketing-theme-toggle" aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'} onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}<span>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span></button>
          </div>
        </div>
        <div className="marketing-container marketing-footer-bottom"><span>© {new Date().getFullYear()} Austral Automatizaciones</span><a href="/registro">Crear una cuenta</a></div>
      </footer>
    </main>
  )
}
