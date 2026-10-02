import { describe, expect, it } from 'vitest'
import { trialHasExpired, trialRemainingDays } from './trial.js'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-02T12:00:00Z')

describe('trialRemainingDays', () => {
  it('cuenta ventanas de 24 h redondeando hacia arriba', () => {
    expect(trialRemainingDays(NOW + 15 * DAY, NOW)).toBe(15)
    expect(trialRemainingDays(NOW + 14 * DAY + 1, NOW)).toBe(15)
    expect(trialRemainingDays(NOW + DAY, NOW)).toBe(1)
  })

  it('mientras la prueba está vigente nunca muestra 0', () => {
    expect(trialRemainingDays(NOW + 1, NOW)).toBe(1)
  })

  it('al vencer o después devuelve 0', () => {
    expect(trialRemainingDays(NOW, NOW)).toBe(0)
    expect(trialRemainingDays(NOW - DAY, NOW)).toBe(0)
  })

  it('acepta Date, número o texto ISO', () => {
    expect(trialRemainingDays(new Date(NOW + 2 * DAY), new Date(NOW))).toBe(2)
    expect(trialRemainingDays('2026-10-05T12:00:00Z', '2026-10-02T12:00:00Z')).toBe(3)
  })

  it('con fechas inválidas devuelve 0', () => {
    expect(trialRemainingDays(null, NOW)).toBe(0)
    expect(trialRemainingDays('no-es-fecha', NOW)).toBe(0)
    expect(trialRemainingDays(NOW + DAY, 'no-es-fecha')).toBe(0)
  })
})

describe('trialHasExpired', () => {
  it('vence exactamente al llegar a la fecha de fin', () => {
    expect(trialHasExpired(NOW + 1, NOW)).toBe(false)
    expect(trialHasExpired(NOW, NOW)).toBe(true)
    expect(trialHasExpired(NOW - 1, NOW)).toBe(true)
  })

  it('una fecha inválida no se considera vencida (sólo presentación)', () => {
    expect(trialHasExpired(null, NOW)).toBe(false)
    expect(trialHasExpired('no-es-fecha', NOW)).toBe(false)
  })
})
