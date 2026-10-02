// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { getBillingReturnState } from './billingReturnState.js'

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('getBillingReturnState', () => {
  it.each(['success', 'pending', 'failure', 'cancel'])('reconoce billing=%s como pista de UX', (kind) => {
    const state = getBillingReturnState(`?billing=${kind}`)
    expect(state.kind).toBe(kind)
    expect(state.message).toMatch(/backend|proveedor/)
  })

  it('el retorno exitoso aclara que la pantalla no activa la suscripción', () => {
    expect(getBillingReturnState('?billing=success').message).toContain('no activa la suscripcion')
  })

  it.each(['', '?billing=', '?billing=approved', '?billing=SUCCESS', '?otro=success'])('ignora %j', (search) => {
    expect(getBillingReturnState(search)).toBeNull()
  })

  it('lee window.location.search por defecto', () => {
    window.history.replaceState(null, '', '/cuenta/facturacion?billing=pending&x=1')
    expect(getBillingReturnState()).toMatchObject({ kind: 'pending' })
  })
})
