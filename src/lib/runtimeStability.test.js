import { describe, expect, it } from 'vitest'
import {
  RUNTIME_REVALIDATION_INTERVAL_MS,
  classifyBillingFailure,
  initialWorkspaceCollection,
  isSubscriptionMissingError,
  shouldRevalidateInBackground,
} from './runtimeStability.js'

describe('isSubscriptionMissingError / classifyBillingFailure', () => {
  it.each([
    [{ code: 'subscription_missing' }],
    [{ code: 'P0002' }],
    [{ status: 409, message: 'El negocio no tiene una suscripción activa' }],
    [{ message: 'No hay una suscripcion registrada' }],
  ])('reconoce la falta de suscripción: %j', (error) => {
    expect(isSubscriptionMissingError(error)).toBe(true)
    expect(classifyBillingFailure(error)).toEqual({ kind: 'subscription_missing', technical: false })
  })

  it.each([
    [null],
    [{ code: '500', message: 'Internal error' }],
    [{ status: 409, message: 'conflict' }],
  ])('el resto es un error técnico: %j', (error) => {
    expect(isSubscriptionMissingError(error)).toBe(false)
    expect(classifyBillingFailure(error)).toEqual({ kind: 'technical_error', technical: true })
  })
})

describe('shouldRevalidateInBackground', () => {
  it('revalida cada 30 segundos como mínimo', () => {
    expect(RUNTIME_REVALIDATION_INTERVAL_MS).toBe(30_000)
    expect(shouldRevalidateInBackground({ now: 100_000, lastRevalidatedAt: 70_001 })).toBe(false)
    expect(shouldRevalidateInBackground({ now: 100_000, lastRevalidatedAt: 70_000 })).toBe(true)
    expect(shouldRevalidateInBackground({ now: 100_000 })).toBe(true)
    expect(shouldRevalidateInBackground({ now: 100_000, lastRevalidatedAt: null })).toBe(true)
  })
})

describe('initialWorkspaceCollection', () => {
  it('en demo usa los datos de demo (o el fallback)', () => {
    expect(initialWorkspaceCollection({ demoMode: true, demoValue: ['demo'], fallbackValue: ['mock'] })).toEqual(['demo'])
    expect(initialWorkspaceCollection({ demoMode: true, fallbackValue: ['mock'] })).toEqual(['mock'])
  })

  it('con Supabase configurado arranca vacío: nunca muestra datos de ejemplo a un negocio real', () => {
    expect(initialWorkspaceCollection({ remoteConfigured: true, fallbackValue: ['mock'] })).toEqual([])
  })

  it('sin backend usa el fallback local', () => {
    expect(initialWorkspaceCollection({ fallbackValue: ['mock'] })).toEqual(['mock'])
    expect(initialWorkspaceCollection()).toEqual([])
  })
})
