// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { exportarCSV, parseLeadsCsv } from './csv.js'

describe('importación CSV por registros completos (44)', () => {
  it('no convierte la segunda línea de una nota en otro contacto válido', () => {
    const result = parseLeadsCsv('nombre,negocio,notas\nAna,Salon,"Primera linea\nEva,Norte"')
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ nombre: 'Ana', negocio: 'Salon', notas: 'Primera linea\nEva,Norte' })
  })

  it.each(['\n', '\r\n', '\r'])('preserva saltos %j y líneas vacías dentro de comillas', (newline) => {
    const notes = `uno${newline}${newline}dos; tres, cuatro`
    const result = parseLeadsCsv(`nombre;negocio;notas${newline}Ana;Sur;"${notes}"${newline}Eva;Norte;ok`)
    expect(result.errors).toEqual([])
    expect(result.rows.map((row) => row.nombre)).toEqual(['Ana', 'Eva'])
    expect(result.rows[0].notas).toBe(notes)
  })

  it('ignora separadores dentro de encabezados entre comillas', () => {
    const result = parseLeadsCsv('nombre;negocio;"ignorar,,,,";notas\nAna;Sur;x;ok')
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({ nombre: 'Ana', negocio: 'Sur', notas: 'ok' })
  })

  it('respeta BOM, comillas escapadas y espacios exteriores', () => {
    const result = parseLeadsCsv('\uFEFFnombre,negocio,notas\n  "Pérez, Ana"  ,Sur,"Dijo ""sí""\ny volvió"')
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({ nombre: 'Pérez, Ana', notas: 'Dijo "sí"\ny volvió' })
  })

  it.each([
    'nombre,negocio,notas\nAna,Sur,"sin cierre',
    'nombre,negocio,notas\nAna,Sur,"nota"texto',
    '"nombre,negocio\nAna,Sur',
    'nombre,negocio\nAna,Sur,columna extra',
  ])('bloquea un archivo malformado sin devolver filas importables: %s', (csv) => {
    const result = parseLeadsCsv(csv)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.rows).toEqual([])
  })

  it('no entrega filas previas si el último registro tiene comillas sin cerrar', () => {
    const result = parseLeadsCsv('nombre,negocio,notas\nAna,Sur,ok\nEva,Norte,"sin cierre')
    expect(result.errors).toEqual([{ row: 3, message: 'Hay un campo con comillas sin cerrar.' }])
    expect(result.rows).toEqual([])
  })

  it('numera errores por la línea física de inicio del registro', () => {
    const result = parseLeadsCsv('nombre,negocio,notas\nAna,Sur,"uno\ndos"\n\nEva,,x')
    expect(result.errors).toContainEqual({ row: 5, message: 'Nombre y negocio son obligatorios.' })
  })

  it('sigue detectando fórmulas aunque la celda contenga saltos de línea', () => {
    const result = parseLeadsCsv('nombre,negocio,notas\nAna,Sur,"=1+1\ntexto"')
    expect(result.errors).toEqual([{ row: 2, message: 'Valor no permitido en notas.' }])
  })

  it('acepta 500 registros y rechaza 501 sin cortar contactos en silencio', () => {
    const csv = (count) => 'nombre,negocio\n' + Array.from({ length: count }, (_, i) => `Ana ${i},Sur`).join('\n')
    expect(parseLeadsCsv(csv(500)).errors).toEqual([])
    const excessive = parseLeadsCsv(csv(501))
    expect(excessive.rows).toEqual([])
    expect(excessive.errors[0].message).toMatch(/500/)
  })

  it('exportar e importar conserva una nota multilinea y comillas sin agregar filas', async () => {
    let blob
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: vi.fn((value) => { blob = value; return 'blob:csv-test' }),
      revokeObjectURL: vi.fn(),
    }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      exportarCSV('leads.csv', [{ nombre: 'Ana', negocio: 'Sur', notas: 'Dijo "sí"\nEva,Norte' }], [
        { key: 'nombre', label: 'nombre' }, { key: 'negocio', label: 'negocio' }, { key: 'notas', label: 'notas' },
      ])
      const text = await blob.text()
      const result = parseLeadsCsv(text)
      expect(result.errors).toEqual([])
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].notas).toBe('Dijo "sí"\nEva,Norte')
    } finally {
      vi.unstubAllGlobals()
      click.mockRestore()
    }
  })
})
