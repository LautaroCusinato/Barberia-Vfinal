// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_PREFERENCE_KEY,
  clearWorkspacePreference,
  parseWorkspacePreference,
  readWorkspacePreference,
  saveWorkspacePreference,
} from './workspacePreference.js'

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    data,
  }
}

const brokenStorage = {
  getItem() { throw new Error('SecurityError') },
  setItem() { throw new Error('QuotaExceededError') },
  removeItem() { throw new Error('SecurityError') },
}

describe('parseWorkspacePreference', () => {
  it('acepta la preferencia de plataforma y descarta datos extra', () => {
    expect(parseWorkspacePreference('{"type":"platform","tenantId":5}')).toEqual({ type: 'platform' })
  })

  it('acepta un negocio con id positivo (texto o número, o el alias selected_tenant_id)', () => {
    expect(parseWorkspacePreference('{"type":"business","tenantId":"12"}')).toEqual({ type: 'business', tenantId: '12' })
    expect(parseWorkspacePreference({ type: 'business', tenantId: 12 })).toEqual({ type: 'business', tenantId: '12' })
    expect(parseWorkspacePreference({ type: 'business', selected_tenant_id: 3 })).toEqual({ type: 'business', tenantId: '3' })
  })

  it.each([
    [null],
    [''],
    ['no-json'],
    ['null'],
    ['{"type":"admin"}'],
    [{ type: 'business' }],
    [{ type: 'business', tenantId: '0' }],
    [{ type: 'business', tenantId: '-1' }],
    [{ type: 'business', tenantId: '1.5' }],
    [{ type: 'business', tenantId: '12; DROP' }],
  ])('rechaza %j', (raw) => {
    expect(parseWorkspacePreference(raw)).toBeNull()
  })
})

describe('read / save / clear', () => {
  it('guarda y lee la preferencia en el storage recibido', () => {
    const storage = memoryStorage()
    expect(saveWorkspacePreference('business', 8, storage)).toBe(true)
    expect(JSON.parse(storage.data.get(WORKSPACE_PREFERENCE_KEY))).toEqual({ type: 'business', tenantId: '8' })
    expect(readWorkspacePreference(storage)).toEqual({ type: 'business', tenantId: '8' })

    expect(saveWorkspacePreference('platform', 8, storage)).toBe(true)
    expect(readWorkspacePreference(storage)).toEqual({ type: 'platform' })

    clearWorkspacePreference(storage)
    expect(readWorkspacePreference(storage)).toBeNull()
  })

  it('no guarda preferencias inválidas', () => {
    const storage = memoryStorage()
    expect(saveWorkspacePreference('admin', 1, storage)).toBe(false)
    expect(saveWorkspacePreference('business', null, storage)).toBe(false)
    expect(saveWorkspacePreference('business', 'abc', storage)).toBe(false)
    expect(storage.data.size).toBe(0)
  })

  it('ignora preferencias corruptas ya guardadas', () => {
    expect(readWorkspacePreference(memoryStorage({ [WORKSPACE_PREFERENCE_KEY]: '{roto' }))).toBeNull()
  })

  it('no rompe si el storage está bloqueado (modo privado)', () => {
    expect(readWorkspacePreference(brokenStorage)).toBeNull()
    expect(saveWorkspacePreference('platform', null, brokenStorage)).toBe(false)
    expect(() => clearWorkspacePreference(brokenStorage)).not.toThrow()
  })

  it('usa localStorage por defecto', () => {
    expect(saveWorkspacePreference('business', '15')).toBe(true)
    expect(localStorage.getItem(WORKSPACE_PREFERENCE_KEY)).toBe('{"type":"business","tenantId":"15"}')
    expect(readWorkspacePreference()).toEqual({ type: 'business', tenantId: '15' })
    clearWorkspacePreference()
    expect(localStorage.getItem(WORKSPACE_PREFERENCE_KEY)).toBeNull()
  })
})
