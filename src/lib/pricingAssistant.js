const BASE_BY_VERTICAL = { barberia: 19, peluqueria: 24, estetica: 29, tattoo: 35, custom: 19 }

export function recommendPrice({ country = 'AR', vertical = 'custom', employees = 1, expectedUsage = 'standard', whatsapp = false, ai = false, support = 'standard', customization = false } = {}) {
  const base = BASE_BY_VERTICAL[vertical] || BASE_BY_VERTICAL.custom
  const countryFactor = country === 'AR' ? 1 : country === 'UY' ? 1.1 : country === 'ES' ? 1.25 : 1
  const size = Math.max(0, Math.min(Number(employees) - 1, 20)) * 2
  const usage = expectedUsage === 'high' ? 12 : expectedUsage === 'light' ? -4 : 0
  const extras = { whatsapp: whatsapp ? 8 : 0, ai: ai ? 10 : 0, support: support === 'priority' ? 15 : 0, customization: customization ? 20 : 0 }
  const monthly = Math.max(10, Math.round((base * countryFactor + size + usage + Object.values(extras).reduce((sum, value) => sum + value, 0)) / 1))
  return { currency: 'USD', monthly, setup: customization ? 75 : 0, extras, rationale: [`Base vertical: ${base}`, `Ajuste por tamaño: ${size}`, `Uso esperado: ${usage >= 0 ? '+' : ''}${usage}`, 'Mínimo comercial aplicado: USD 10'] }
}
