import { catalogPlan } from './commercialCatalog.js'

// Recomendación explicable sobre el catálogo comercial vigente. No calcula
// importes, conversiones ni descuentos: sólo devuelve el plan publicado.
export function recommendPrice({ employees = 1, _expectedUsage = 'standard', whatsapp = false, ai = false, support = 'standard', customization = false } = {}) {
  const teamSize = Math.max(1, Number(employees) || 1)
  const plan = catalogPlan()
  const extras = { whatsapp: Boolean(whatsapp), ai: Boolean(ai), support: support === 'priority', customization: Boolean(customization) }
  return {
    currency: plan.moneda,
    monthly: plan.precio_mensual,
    setup: 0,
    plan: plan.codigo,
    extras,
    rationale: [`Plan único: ${plan.nombre}`, `Equipo considerado: ${teamSize}`, 'Catálogo vigente: pesos argentinos, facturación mensual', 'No se agregan cargos de implementación ni conversiones'],
  }
}
