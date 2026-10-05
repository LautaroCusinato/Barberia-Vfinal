import { describe, expect, it } from 'vitest'
import { billingStatusTone, classifyBillingLoadFailure, failureAllowsRetry, formatBillingDate, LOAD_FAILURE_COPY, paymentStatusTone } from './billingView.js'

describe('classifyBillingLoadFailure', () => {
  it.each([
    [{ status: 409, code: 'subscription_missing' }, 'subscription_missing'],
    [{ code: 'P0002' }, 'subscription_missing'],
    [{ status: 401, code: 'invalid_session' }, 'session'],
    [{ status: 401, code: 'session_expired' }, 'session'],
    [{ status: 403, code: 'owner_required' }, 'forbidden'],
    [{ status: 403, code: null }, 'forbidden'],
    [{ status: 409, code: 'tenant_selection_required' }, 'tenant_selection'],
    [new TypeError('Failed to fetch'), 'network'],
    [{ status: 502, code: 'billing_status_failed' }, 'technical'],
    [{ status: 500 }, 'technical'],
    [null, 'technical'],
  ])('%j → %s', (error, kind) => {
    expect(classifyBillingLoadFailure(error)).toBe(kind)
  })

  it('cada clase de fallo tiene texto propio sin detalles técnicos', () => {
    for (const kind of ['session', 'forbidden', 'tenant_selection', 'network', 'technical']) {
      expect(LOAD_FAILURE_COPY[kind].title).toBeTruthy()
      expect(`${LOAD_FAILURE_COPY[kind].title} ${LOAD_FAILURE_COPY[kind].description}`).not.toMatch(/owner|tenant|rpc|502|403/i)
    }
  })

  it('sólo los fallos transitorios ofrecen reintentar', () => {
    expect(failureAllowsRetry('network')).toBe(true)
    expect(failureAllowsRetry('technical')).toBe(true)
    expect(failureAllowsRetry('forbidden')).toBe(false)
    expect(failureAllowsRetry('session')).toBe(false)
    expect(failureAllowsRetry('tenant_selection')).toBe(false)
  })
})

describe('tonos', () => {
  it('estados de suscripción', () => {
    expect(billingStatusTone('trialing')).toBe('info')
    expect(billingStatusTone('active')).toBe('success')
    expect(billingStatusTone('past_due')).toBe('warning')
    expect(billingStatusTone('suspended')).toBe('danger')
    expect(billingStatusTone('desconocido')).toBe('neutral')
    expect(billingStatusTone(undefined)).toBe('neutral')
  })

  it('estados de pago', () => {
    expect(paymentStatusTone('APPROVED')).toBe('success')
    expect(paymentStatusTone('in_process')).toBe('warning')
    expect(paymentStatusTone('rejected')).toBe('danger')
    expect(paymentStatusTone(null)).toBe('neutral')
  })
})

describe('formatBillingDate', () => {
  it('formatea fechas válidas y no lanza con inválidas', () => {
    expect(formatBillingDate('2026-10-05T12:00:00Z')).toMatch(/2026/)
    expect(formatBillingDate('no-es-fecha')).toBe('—')
    expect(formatBillingDate(null)).toBe('—')
    expect(formatBillingDate('')).toBe('—')
  })
})
