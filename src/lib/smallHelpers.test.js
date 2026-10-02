// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { colorFor, initials } from './avatar.js'
import { CHAT_BOTTOM_THRESHOLD, isNearBottom, shouldFollowNewMessages } from './chatScroll.js'
import { DRAFT_PROVIDERS, buildDraftRequest, createMockDraft, generateCommercialDraft } from './commercialDraftProvider.js'
import { MESSAGES, getLocale, t } from './i18n.js'
import { getClientContext, installGlobalObservability, reportClientError, trackClientEvent } from './observability.js'

describe('avatar', () => {
  it('initials toma hasta dos iniciales en mayúscula', () => {
    expect(initials('agustín molina')).toBe('AM')
    expect(initials('  Ana  María  López ')).toBe('AM')
    expect(initials('')).toBe('')
  })

  it('colorFor es determinístico y siempre devuelve un color de la paleta', () => {
    expect(colorFor('Ana')).toBe(colorFor('Ana'))
    expect(colorFor('Ana')).toMatch(/^#[0-9A-F]{6}$/)
    expect(colorFor('')).toMatch(/^#[0-9A-F]{6}$/)
  })
})

describe('chatScroll', () => {
  it('considera "abajo" hasta 80px del final', () => {
    expect(CHAT_BOTTOM_THRESHOLD).toBe(80)
    expect(isNearBottom({ scrollTop: 420, scrollHeight: 1000, clientHeight: 500 })).toBe(true)
    expect(isNearBottom({ scrollTop: 419, scrollHeight: 1000, clientHeight: 500 })).toBe(false)
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 1000, clientHeight: 500 }, 600)).toBe(true)
  })

  it('sigue los mensajes nuevos si son propios o si el lector estaba abajo', () => {
    expect(shouldFollowNewMessages({ wasAtBottom: false, ownMessage: true })).toBe(true)
    expect(shouldFollowNewMessages({ wasAtBottom: true })).toBe(true)
    expect(shouldFollowNewMessages({ wasAtBottom: false })).toBe(false)
  })
})

describe('commercialDraftProvider', () => {
  it('arma el pedido con valores por defecto', () => {
    expect(buildDraftRequest({})).toEqual({ lead: {}, language: 'es', channel: 'manual', vertical: 'custom', observedProblem: '', relevantFeatures: [], tone: 'clear', maxLength: 1200 })
  })

  it('el borrador mock personaliza y respeta el largo máximo', () => {
    const draft = createMockDraft(buildDraftRequest({ lead: { nombre_contacto: 'Ana', negocio_nombre: 'Barbería Sur' }, maxLength: 30 }))
    expect(draft.subject).toBe('Una idea para Barbería Sur')
    expect(draft.message).toHaveLength(30)
    expect(draft.message.startsWith('Hola Ana,')).toBe(true)
    expect(draft).toMatchObject({ provider: 'mock', confidence: 'review_required' })
    expect(createMockDraft(buildDraftRequest({ language: 'en' })).subject).toBe('An idea for {{nombre_negocio}}')
  })

  it('el navegador nunca llama a un proveedor externo', async () => {
    await expect(generateCommercialDraft(buildDraftRequest({}), DRAFT_PROVIDERS.DEEPSEEK)).rejects.toThrow(/endpoint privado/)
    await expect(generateCommercialDraft(buildDraftRequest({}))).resolves.toMatchObject({ provider: 'mock' })
  })
})

describe('i18n', () => {
  it('elige inglés sólo para locales en-*', () => {
    expect(getLocale('en-US')).toBe('en')
    expect(getLocale('es-AR')).toBe('es')
    expect(getLocale('pt-BR')).toBe('es')
  })

  it('traduce con fallback a español y a la clave', () => {
    expect(t('login', 'en')).toBe(MESSAGES.en.login)
    expect(t('login', 'fr')).toBe(MESSAGES.es.login)
    expect(t('clave-inexistente', 'es')).toBe('clave-inexistente')
  })
})

describe('observability', () => {
  it('el contexto incluye ruta, versión y un id de correlación', () => {
    const context = getClientContext({ tenant_id: 3 })
    expect(context).toMatchObject({ tenant_id: 3, route: window.location.pathname })
    expect(context.correlation_id).toBeTruthy()
    expect(getClientContext().correlation_id).not.toBe(context.correlation_id)
  })

  it('reportClientError recorta el mensaje y guarda sólo los últimos 20 errores', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    window.__AUSTRAL_CLIENT_ERRORS__ = []
    const reported = reportClientError(new Error('x'.repeat(600)))
    expect(reported.message).toHaveLength(500)
    for (let i = 0; i < 25; i += 1) reportClientError(`error ${i}`)
    expect(window.__AUSTRAL_CLIENT_ERRORS__).toHaveLength(20)
    expect(window.__AUSTRAL_CLIENT_ERRORS__.at(-1).message).toBe('error 24')
  })

  it('trackClientEvent guarda sólo los últimos 50 eventos', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    window.__AUSTRAL_CLIENT_EVENTS__ = []
    for (let i = 0; i < 55; i += 1) trackClientEvent('evento', { i })
    expect(window.__AUSTRAL_CLIENT_EVENTS__).toHaveLength(50)
    expect(window.__AUSTRAL_CLIENT_EVENTS__[0]).toMatchObject({ name: 'evento', i: 5 })
  })

  it('installGlobalObservability se instala una sola vez y se puede desinstalar', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const uninstall = installGlobalObservability()
    const noop = installGlobalObservability()
    expect(window.__AUSTRAL_OBSERVABILITY_INSTALLED__).toBe(true)
    noop()
    expect(window.__AUSTRAL_OBSERVABILITY_INSTALLED__).toBe(true)
    uninstall()
    expect(window.__AUSTRAL_OBSERVABILITY_INSTALLED__).toBe(false)
  })
})
