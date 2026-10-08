import { describe, expect, it } from 'vitest'
import { parseLeadsCsv } from './csv.js'

// Revisión 44: columnas sobrantes vacías (coma final) no pueden partir un
// contacto; antes se importaban y la propuesta rechazaba el archivo entero.
describe('importación CSV — revisión 44', () => {
  it('acepta comas finales o columnas sobrantes vacías', () => {
    const result = parseLeadsCsv('nombre,negocio\nAna,Salon,\nEva,Norte,,\r\n')
    expect(result.errors).toEqual([])
    expect(result.rows.map((row) => [row.nombre, row.negocio])).toEqual([['Ana', 'Salon'], ['Eva', 'Norte']])
  })

  it('acepta columnas sobrantes con sólo espacios o comillas vacías', () => {
    const result = parseLeadsCsv('nombre;negocio\nAna;Salon; ;""')
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
  })

  it('sigue rechazando columnas sobrantes con contenido, sin filas parciales', () => {
    const result = parseLeadsCsv('nombre,negocio\nAna,Salon\nEva,Norte,Sur')
    expect(result.rows).toEqual([])
    expect(result.errors).toEqual([{ row: 3, message: 'Hay más columnas que en el encabezado. Revisá los separadores y las comillas.' }])
  })
})
