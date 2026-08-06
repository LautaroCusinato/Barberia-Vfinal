// Contrato desacoplado para generación de borradores. Este cliente no hace
// llamadas externas: mock es el único proveedor disponible en el navegador.
// DeepSeek u otro proveedor se conectará después desde un endpoint privado.
export const DRAFT_PROVIDERS = Object.freeze({ MOCK: 'mock', DEEPSEEK: 'deepseek', OTHER: 'other' })

export function buildDraftRequest({ lead, language = 'es', channel = 'manual', vertical = 'custom', observedProblem = '', relevantFeatures = [], tone = 'clear', maxLength = 1200 }) {
  return { lead: lead || {}, language, channel, vertical, observedProblem, relevantFeatures, tone, maxLength }
}

export function createMockDraft(request) {
  const name = request.lead?.nombre_contacto || request.lead?.nombre || '{{nombre_contacto}}'
  const business = request.lead?.negocio?.nombre || request.lead?.negocio_nombre || '{{nombre_negocio}}'
  const problem = request.observedProblem || 'ordenar reservas y clientes'
  const message = request.language === 'en'
    ? `Hi ${name},\n\nI prepared a short idea for ${business} based on ${problem}. If useful, we can review it without changing your current operation.\n\nWould you like to see a short demo?`
    : `Hola ${name},\n\nPreparé una idea breve para ${business} a partir de ${problem}. Si te sirve, podemos revisarla sin cambiar toda tu operación.\n\n¿Te gustaría ver una demo breve?`
  return { subject: request.language === 'en' ? `An idea for ${business}` : `Una idea para ${business}`, message: message.slice(0, request.maxLength), cta: request.language === 'en' ? 'See a short demo' : 'Ver una demo breve', personalizationReasons: ['vertical', 'observed_problem'], warnings: ['Revisar nombre y datos antes de aprobar'], confidence: 'review_required', provider: DRAFT_PROVIDERS.MOCK }
}

export async function generateCommercialDraft(request, provider = DRAFT_PROVIDERS.MOCK) {
  if (provider !== DRAFT_PROVIDERS.MOCK) throw new Error('El proveedor externo sólo se habilita desde un endpoint privado aprobado.')
  return createMockDraft(request)
}
