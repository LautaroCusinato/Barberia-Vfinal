const MESSAGES = {
  es: { product: 'Austral Automatizaciones', eyebrow: 'Operación simple para negocios que crecen', title: 'Más turnos organizados. Menos tareas repetidas.', description: 'Una plataforma para reservas, clientes, equipo y automatizaciones, adaptable a barberías, estética y servicios profesionales.', trial: 'Probá gratis durante 14 días', login: 'Ingresar', demo: 'Ver cómo funciona', benefits: 'Todo lo importante en un solo lugar', steps: 'Empezá en tres pasos', plans: 'Planes claros, sin sorpresas', faq: 'Preguntas frecuentes', contact: '¿Querés hablar con nosotros?', footer: 'La conexión de WhatsApp puede requerir configuración adicional.' },
  en: { product: 'Austral Automations', eyebrow: 'Simple operations for growing businesses', title: 'More organized bookings. Fewer repetitive tasks.', description: 'A platform for bookings, customers, teams and automations, adaptable to barbershops, beauty and professional services.', trial: 'Try it free for 14 days', login: 'Sign in', demo: 'See how it works', benefits: 'Everything important in one place', steps: 'Start in three steps', plans: 'Clear plans, no surprises', faq: 'Frequently asked questions', contact: 'Want to talk to us?', footer: 'WhatsApp connection may require additional setup.' },
}

export function getLocale(locale = navigator.language) { return String(locale).toLowerCase().startsWith('en') ? 'en' : 'es' }
export function t(key, locale = getLocale()) { return MESSAGES[locale]?.[key] || MESSAGES.es[key] || key }
export { MESSAGES }
