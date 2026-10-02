// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_TRANSITION_KEY,
  clearWorkspaceTransition,
  hasWorkspaceTransition,
  markWorkspaceTransition,
} from './workspaceTransition.js'

describe('workspaceTransition', () => {
  it('marca una transición vigente durante 60 segundos', () => {
    const inicio = 1_000_000
    expect(markWorkspaceTransition(inicio)).toBe(true)
    expect(sessionStorage.getItem(WORKSPACE_TRANSITION_KEY)).toBe(String(inicio))
    expect(hasWorkspaceTransition(inicio + 59_999)).toBe(true)
    expect(hasWorkspaceTransition(inicio + 60_000)).toBe(false)
  })

  it('clear elimina la marca', () => {
    markWorkspaceTransition(Date.now())
    expect(clearWorkspaceTransition()).toBe(true)
    expect(hasWorkspaceTransition()).toBe(false)
  })

  it('no hay transición sin marca o con un valor corrupto', () => {
    expect(hasWorkspaceTransition()).toBe(false)
    sessionStorage.setItem(WORKSPACE_TRANSITION_KEY, 'no-es-numero')
    expect(hasWorkspaceTransition()).toBe(false)
    sessionStorage.setItem(WORKSPACE_TRANSITION_KEY, '0')
    expect(hasWorkspaceTransition()).toBe(false)
  })

  it('devuelve false si sessionStorage falla', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('SecurityError') })
    expect(markWorkspaceTransition()).toBe(false)
    expect(hasWorkspaceTransition()).toBe(false)
    expect(clearWorkspaceTransition()).toBe(false)
  })
})
