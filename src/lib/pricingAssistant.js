import { catalogPlan } from './commercialCatalog.js'

// Recomendación explicable sobre el catálogo comercial vigente. No calcula
// importes, conversiones ni descuentos: sólo elige un tier ya publicado.
export function recommendPrice({ employees = 1, expectedUsage = 'standard', whatsapp = false, ai = false, support = 'standard', customization = false } = {}) {
  const teamSize = Math.max(1, Number(employees) || 1)
  const premiumSignal = teamSize > 10 || support === 'priority' || customization
  const proSignal = teamSize > 3 || expectedUsage === 'high' || whatsapp || ai
  const code = premiumSignal ? 'premium' : proSignal ? 'pro' : 'starter'
  const plan = catalogPlan(code)
  const extras = { whatsapp: Boolean(whatsapp), ai: Boolean(ai), support: support === 'priority', customization: Boolean(customization) }
  return {
    currency: plan.moneda,
    monthly: plan.precio_mensual,
    setup: 0,
    plan: plan.codigo,
    extras,
    rationale: [`Plan recomendado: ${plan.nombre}`, `Equipo considerado: ${teamSize}`, 'Catálogo vigente: pesos argentinos, facturación mensual', 'No se agregan cargos de implementación ni conversiones'],
  }
}
