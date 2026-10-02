import assert from 'node:assert/strict'
import {
  PREFIJO_AR,
  digitosNacionales,
  extraerNumeroLocal,
  formatTelefonoAR,
  formatTelefonoDisplay,
  soloDigitos,
  telefonoNacionalValido,
} from '../src/lib/text.js'

// AMBA y el interior tienen que poder cargarse: el área ya no es fija.
assert.equal(formatTelefonoAR('1155221234'), '+54 9 11 5522-1234')
assert.equal(formatTelefonoAR('3515551234'), '+54 9 351 555-1234')
assert.equal(formatTelefonoAR('351'), '+54 9 351')
assert.equal(formatTelefonoAR('11552212349999'), '+54 9 11 5522-1234', 'Se corta en 10 dígitos nacionales')
assert.equal(soloDigitos(formatTelefonoAR('3515551234')), '5493515551234', 'Se persiste en el formato del bot de WhatsApp')

assert.equal(telefonoNacionalValido(formatTelefonoAR('3515551234')), true)
assert.equal(telefonoNacionalValido(formatTelefonoAR('11223344')), false, 'El formato viejo de 8 dígitos ya no alcanza')
assert.equal(telefonoNacionalValido(PREFIJO_AR), false)
assert.equal(digitosNacionales('+54 9 11 5522-1234'), '1155221234', 'Los datos demo con el formato anterior siguen leyéndose')

// Teléfonos ya guardados con formatos históricos.
assert.equal(extraerNumeroLocal('5491155221234'), '1155221234')
assert.equal(extraerNumeroLocal('5493515551234'), '3515551234')
assert.equal(extraerNumeroLocal('543515551234'), '3515551234', 'Sin el 9 de celular')
assert.equal(extraerNumeroLocal('55221234'), '1155221234', 'El formato histórico de 8 dígitos asumía el área 11')
assert.equal(extraerNumeroLocal(''), '')

assert.equal(formatTelefonoDisplay('5491138922851'), '+54 9 11 3892-2851')
assert.equal(formatTelefonoDisplay('5493515551234'), '+54 9 351 555-1234')
assert.equal(formatTelefonoDisplay('+1 555 0100'), '+1 555 0100', 'Lo que no es un celular argentino se muestra tal cual')

console.log('Phone format checks passed')
