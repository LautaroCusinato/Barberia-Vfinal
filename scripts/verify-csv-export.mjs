import assert from 'node:assert/strict'
import { neutralizarFormulaCsv } from '../src/lib/csv.js'

// Celdas con fórmulas (nombres que llegan por WhatsApp) quedan como texto.
assert.equal(neutralizarFormulaCsv('=HYPERLINK("http://x","clic")'), '\'=HYPERLINK("http://x","clic")')
assert.equal(neutralizarFormulaCsv('+cmd'), '\'+cmd')
assert.equal(neutralizarFormulaCsv('-2+3'), '\'-2+3')
assert.equal(neutralizarFormulaCsv('@SUM(A1)'), '\'@SUM(A1)')
assert.equal(neutralizarFormulaCsv('\t=1'), '\'\t=1')

// Valores legítimos no cambian.
assert.equal(neutralizarFormulaCsv('Juan Pérez'), 'Juan Pérez')
assert.equal(neutralizarFormulaCsv('5491155221234'), '5491155221234')
assert.equal(neutralizarFormulaCsv(-150), '-150')
assert.equal(neutralizarFormulaCsv('1500,50'), '1500,50')
assert.equal(neutralizarFormulaCsv(null), '')

console.log('CSV export checks passed')
