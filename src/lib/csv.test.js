import { describe, expect, it, vi } from 'vitest'
import { exportarCSV, isDangerousCsvValue, neutralizarFormulaCsv, parseLeadsCsv } from './csv.js'

describe('neutralizarFormulaCsv', () => {
  it.each([
    ['=HYPERLINK("http://x","clic")', '\'=HYPERLINK("http://x","clic")'],
    ['+cmd', "'+cmd"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\t=1', "'\t=1"],
    ['\r=1', "'\r=1"],
    ['+54 9 11 5522-1234', "'+54 9 11 5522-1234"], // formateado con espacios: Excel lo evaluaría
  ])('prefija con comilla las celdas que Excel/Sheets ejecutarían: %j', (input, expected) => {
    expect(neutralizarFormulaCsv(input)).toBe(expected)
  })

  it.each([
    ['Juan Pérez'],
    ['5491155221234'],
    ['+5491155221234'],
    ['-150'],
    ['1500,50'],
    ['1500.50'],
    ['correo@ejemplo.com'], // la @ en el medio no es fórmula
    [' =1+1'], // con espacio delante se abre como texto
  ])('deja intactos los valores legítimos: %j', (input) => {
    expect(neutralizarFormulaCsv(input)).toBe(input)
  })

  it('convierte a texto números, null y undefined', () => {
    expect(neutralizarFormulaCsv(-150)).toBe('-150')
    expect(neutralizarFormulaCsv(0)).toBe('0')
    expect(neutralizarFormulaCsv(null)).toBe('')
    expect(neutralizarFormulaCsv(undefined)).toBe('')
  })
})

describe('exportarCSV', () => {
  function capturarDescarga() {
    const blobs = []
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: vi.fn((blob) => { blobs.push(blob); return 'blob:csv' }),
      revokeObjectURL: vi.fn(),
    }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    return { blobs, click }
  }

  it('descarga un CSV con BOM, escapando comillas, comas y saltos y neutralizando fórmulas', async () => {
    const { blobs, click } = capturarDescarga()
    exportarCSV('clientes.csv', [
      { nombre: 'Ana, "la jefa"', telefono: '5491155221234', nota: '=1+1' },
      { nombre: 'Luis', telefono: null, nota: 'línea 1\nlínea 2' },
    ], [
      { key: 'nombre', label: 'Nombre' },
      { key: 'telefono', label: 'Teléfono' },
      { key: 'nota', label: 'Nota' },
    ])

    expect(click).toHaveBeenCalledTimes(1)
    expect(blobs).toHaveLength(1)
    expect(blobs[0].type).toBe('text/csv;charset=utf-8;')
    const bytes = new Uint8Array(await blobs[0].arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // BOM para Excel
    const texto = new TextDecoder().decode(bytes.slice(3))
    expect(texto).toBe([
      'Nombre,Teléfono,Nota',
      '"Ana, ""la jefa""",5491155221234,\'=1+1',
      'Luis,,"línea 1\nlínea 2"',
    ].join('\n'))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:csv')
    expect(document.querySelector('a[download]')).toBeNull()
  })
})

describe('isDangerousCsvValue', () => {
  it('marca valores que empiezan con = + - @ (ignorando espacios)', () => {
    expect(isDangerousCsvValue('=cmd')).toBe(true)
    expect(isDangerousCsvValue('  @x')).toBe(true)
    expect(isDangerousCsvValue('-10%')).toBe(true)
    expect(isDangerousCsvValue('+54')).toBe(true)
    expect(isDangerousCsvValue('Ana')).toBe(false)
    expect(isDangerousCsvValue(null)).toBe(false)
  })
})

describe('parseLeadsCsv', () => {
  it('reporta un archivo vacío', () => {
    expect(parseLeadsCsv('')).toEqual({ headers: [], rows: [], errors: [{ row: 1, message: 'El archivo está vacío.' }] })
    expect(parseLeadsCsv('\n\n  \n')).toMatchObject({ rows: [], errors: [{ row: 1 }] })
    expect(parseLeadsCsv(null).errors).toHaveLength(1)
  })

  it('mapea encabezados por alias, sin acentos ni mayúsculas, y quita el BOM', () => {
    const { headers, mapping, rows, errors, warnings } = parseLeadsCsv(
      '﻿Contacto,Empresa,E-mail,Teléfono,País,Idioma,Rubro,Origen,Sitio web,Observaciones\r\n'
      + 'Ana,Barbería Sur,ana@sur.com,+54 9 11 5522-1234,AR,es,barberia,referido,https://sur.com,llamar\r\n',
    )
    expect(headers[0]).toBe('Contacto')
    expect(mapping).toEqual({ nombre: 0, negocio: 1, email: 2, telefono: 3, pais: 4, idioma: 5, rubro: 6, fuente: 7, url: 8, notas: 9 })
    expect(rows).toEqual([{
      nombre: 'Ana', negocio: 'Barbería Sur', email: 'ana@sur.com', telefono: '+54 9 11 5522-1234',
      pais: 'AR', idioma: 'es', rubro: 'barberia', fuente: 'referido', url: 'https://sur.com', notas: 'llamar',
    }])
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('detecta punto y coma como separador cuando predomina en el encabezado', () => {
    const { rows, errors } = parseLeadsCsv('nombre;negocio;notas\nAna;Sur;precio 1,5 millones')
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({ nombre: 'Ana', negocio: 'Sur', notas: 'precio 1,5 millones' })
  })

  it('respeta comillas, separadores dentro de comillas y comillas escapadas', () => {
    const { rows } = parseLeadsCsv('nombre,negocio,notas\n"Pérez, Ana","Barbería ""El Rey""",  con espacios  ')
    expect(rows[0]).toMatchObject({ nombre: 'Pérez, Ana', negocio: 'Barbería "El Rey"', notas: 'con espacios' })
  })

  it('exige nombre y negocio, valida el email y numera filas como en la planilla', () => {
    const { errors } = parseLeadsCsv('nombre,negocio,email\nAna,,ana@sur.com\n,Sur,\nLuis,Norte,no-es-email\nEva,Este,eva@este.com')
    expect(errors).toEqual([
      { row: 2, message: 'Nombre y negocio son obligatorios.' },
      { row: 3, message: 'Nombre y negocio son obligatorios.' },
      { row: 4, message: 'Email inválido.' },
    ])
  })

  it('rechaza inyección de fórmulas en cualquier campo de texto', () => {
    const { errors } = parseLeadsCsv('nombre,negocio,notas,url\n=HYPERLINK("x"),Sur,ok,\nAna,@Sur,-10% off,+x')
    expect(errors).toEqual([
      { row: 2, message: 'Valor no permitido en nombre.' },
      { row: 3, message: 'Valor no permitido en negocio, url, notas.' },
    ])
  })

  it('en el teléfono permite +54 pero rechaza = y @', () => {
    expect(parseLeadsCsv('nombre,negocio,telefono\nAna,Sur,+5491155221234').errors).toEqual([])
    expect(parseLeadsCsv('nombre,negocio,telefono\nAna,Sur,=1+1').errors).toEqual([{ row: 2, message: 'Valor no permitido en telefono.' }])
    expect(parseLeadsCsv('nombre,negocio,telefono\nAna,Sur, @x').errors).toEqual([{ row: 2, message: 'Valor no permitido en telefono.' }])
  })

  it('avisa (sin bloquear) cuando faltan país o idioma', () => {
    const { errors, warnings } = parseLeadsCsv('nombre,negocio\nAna,Sur')
    expect(errors).toEqual([])
    expect(warnings).toEqual([
      { row: 2, message: 'País faltante: se importará sin país.' },
      { row: 2, message: 'Idioma faltante: se usará es.' },
    ])
  })

  it('completa con vacío las columnas faltantes y descarta líneas en blanco', () => {
    const { rows } = parseLeadsCsv('name,company,country\n\nAna,Sur\n   \n')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ nombre: 'Ana', negocio: 'Sur', pais: '', email: '' })
  })
})
