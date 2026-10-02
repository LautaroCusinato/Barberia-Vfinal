import { describe, expect, it } from 'vitest'
import {
  PREFIJO_AR,
  TELEFONO_NACIONAL_DIGITOS,
  digitosNacionales,
  extraerNumeroLocal,
  formatNumeroNacional,
  formatTelefonoAR,
  formatTelefonoDisplay,
  soloDigitos,
  telefonoCompleto,
  telefonoNacionalValido,
  telefonoSinPrefijo,
} from './text.js'

describe('formatTelefonoAR', () => {
  it('usa el prefijo de celular argentino +54 9', () => {
    expect(PREFIJO_AR).toBe('+54 9 ')
    expect(TELEFONO_NACIONAL_DIGITOS).toBe(10)
    expect(formatTelefonoAR('')).toBe('+54 9 ')
  })

  it.each([
    ['1155221234', '+54 9 11 5522-1234'], // AMBA: área de 2 dígitos
    ['3515551234', '+54 9 351 555-1234'], // Córdoba: área de 3
    ['2944123456', '+54 9 294 412-3456'], // Bariloche (área 2944): sólo presentación
    ['2214567890', '+54 9 221 456-7890'], // La Plata
  ])('formatea %s con cualquier código de área', (input, expected) => {
    expect(formatTelefonoAR(input)).toBe(expected)
  })

  it('formatea parcialmente mientras se tipea', () => {
    expect(formatTelefonoAR('1')).toBe('+54 9 1')
    expect(formatTelefonoAR('11')).toBe('+54 9 11')
    expect(formatTelefonoAR('115')).toBe('+54 9 11 5')
    expect(formatTelefonoAR('115522')).toBe('+54 9 11 5522')
    expect(formatTelefonoAR('1155221')).toBe('+54 9 11 5-5221')
    expect(formatTelefonoAR('351')).toBe('+54 9 351')
    expect(formatTelefonoAR('3515')).toBe('+54 9 351 5')
  })

  it('corta en 10 dígitos nacionales', () => {
    expect(formatTelefonoAR('11552212349999')).toBe('+54 9 11 5522-1234')
    expect(formatTelefonoAR('35155512349')).toBe('+54 9 351 555-1234')
  })

  it('ignora todo lo que no sea dígito', () => {
    expect(formatTelefonoAR('11-5522 abc 1234')).toBe('+54 9 11 5522-1234')
    expect(formatTelefonoAR('(351) 555.1234')).toBe('+54 9 351 555-1234')
  })

  it('es idempotente sobre su propia salida nacional', () => {
    const visible = formatTelefonoAR('3515551234')
    expect(formatTelefonoAR(visible.slice(PREFIJO_AR.length))).toBe(visible)
  })

  it('al pegar un número completo quita el código de país o el 0 troncal en vez de recortarlo', () => {
    expect(formatTelefonoAR('+54 9 11 5522-1234')).toBe('+54 9 11 5522-1234')
    expect(formatTelefonoAR('5493515551234')).toBe('+54 9 351 555-1234')
    expect(formatTelefonoAR('+54 351 555-1234')).toBe('+54 9 351 555-1234')
    expect(formatTelefonoAR('011 5522-1234')).toBe('+54 9 11 5522-1234')
    expect(formatTelefonoAR('0351 555-1234')).toBe('+54 9 351 555-1234')
  })

  it('se persiste en el formato del bot de WhatsApp (sólo dígitos)', () => {
    expect(soloDigitos(formatTelefonoAR('3515551234'))).toBe('5493515551234')
  })
})

describe('formatNumeroNacional', () => {
  it('pone guion antes de los últimos 4 dígitos', () => {
    expect(formatNumeroNacional('1155221234')).toBe('11 5522-1234')
    expect(formatNumeroNacional('11552')).toBe('11 552')
    expect(formatNumeroNacional('115522123')).toBe('11 552-2123')
    expect(formatNumeroNacional('351555123')).toBe('351 55-5123')
  })
})

describe('digitosNacionales / telefonoNacionalValido', () => {
  it('devuelve área + número de un valor de PhoneField', () => {
    expect(digitosNacionales('+54 9 11 5522-1234')).toBe('1155221234')
    expect(digitosNacionales('+54 9 351 555-1234')).toBe('3515551234')
    expect(digitosNacionales(PREFIJO_AR)).toBe('')
    expect(digitosNacionales('')).toBe('')
    expect(digitosNacionales(null)).toBe('')
  })

  it('sólo es válido con exactamente 10 dígitos nacionales', () => {
    expect(telefonoNacionalValido(formatTelefonoAR('3515551234'))).toBe(true)
    expect(telefonoNacionalValido(formatTelefonoAR('1155221234'))).toBe(true)
    expect(telefonoNacionalValido(formatTelefonoAR('11223344'))).toBe(false) // formato viejo de 8
    expect(telefonoNacionalValido(formatTelefonoAR('351555123'))).toBe(false)
    expect(telefonoNacionalValido(PREFIJO_AR)).toBe(false)
    expect(telefonoNacionalValido('')).toBe(false)
  })
})

describe('telefonoCompleto / telefonoSinPrefijo', () => {
  it('telefonoCompleto indica si se cargó algún dígito después del prefijo', () => {
    expect(telefonoCompleto(PREFIJO_AR)).toBe(false)
    expect(telefonoCompleto('+54 9 1')).toBe(true)
  })

  it('telefonoSinPrefijo quita sólo el prefijo propio', () => {
    expect(telefonoSinPrefijo('+54 9 11 5522-1234')).toBe('11 5522-1234')
    expect(telefonoSinPrefijo('11 5522-1234')).toBe('11 5522-1234')
    expect(telefonoSinPrefijo('')).toBe('')
    expect(telefonoSinPrefijo(undefined)).toBe('')
  })
})

describe('extraerNumeroLocal', () => {
  it.each([
    ['5491155221234', '1155221234'], // formato del bot
    ['+54 9 11 5522-1234', '1155221234'], // formato visible
    ['5493515551234', '3515551234'],
    ['543515551234', '3515551234'], // sin el 9 de celular
    ['+54 11 5522-1234', '1155221234'],
    ['1155221234', '1155221234'], // ya nacional
    ['55221234', '1155221234'], // histórico de 8 dígitos: área 11
    ['5522-1234', '1155221234'],
    ['01155221234', '1155221234'], // con 0 troncal: últimos 10
  ])('normaliza %s', (input, expected) => {
    expect(extraerNumeroLocal(input)).toBe(expected)
  })

  it('devuelve vacío o lo parcial cuando no hay número completo', () => {
    expect(extraerNumeroLocal('')).toBe('')
    expect(extraerNumeroLocal(undefined)).toBe('')
    expect(extraerNumeroLocal('351')).toBe('351')
  })

  it('su salida carga bien en el PhoneField', () => {
    expect(formatTelefonoAR(extraerNumeroLocal('5493515551234'))).toBe('+54 9 351 555-1234')
    expect(formatTelefonoAR(extraerNumeroLocal('38922851'))).toBe('+54 9 11 3892-2851')
  })
})

describe('formatTelefonoDisplay', () => {
  it('muestra lindo un celular argentino guardado en dígitos', () => {
    expect(formatTelefonoDisplay('5491138922851')).toBe('+54 9 11 3892-2851')
    expect(formatTelefonoDisplay('5493515551234')).toBe('+54 9 351 555-1234')
    expect(formatTelefonoDisplay('+54 9 351 555-1234')).toBe('+54 9 351 555-1234')
  })

  it('deja tal cual lo que no es un celular argentino completo', () => {
    expect(formatTelefonoDisplay('+1 555 0100')).toBe('+1 555 0100')
    expect(formatTelefonoDisplay('1155221234')).toBe('1155221234')
    expect(formatTelefonoDisplay('541155221234')).toBe('541155221234')
  })

  it('devuelve vacío sin valor', () => {
    expect(formatTelefonoDisplay('')).toBe('')
    expect(formatTelefonoDisplay(null)).toBe('')
    expect(formatTelefonoDisplay(undefined)).toBe('')
  })
})
