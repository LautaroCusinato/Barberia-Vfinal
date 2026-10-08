// Nombres y textos pueden venir de WhatsApp (los escribe un tercero). Una
// celda que empieza con = + - @ se ejecuta como fórmula al abrir el CSV en
// Excel/Sheets; la prefijamos con ' para que quede como texto. Los números
// (precios, teléfonos en dígitos) no se tocan.
export function neutralizarFormulaCsv(value) {
  const s = String(value ?? '')
  if (/^[+-]?\d+([.,]\d+)?$/.test(s.trim())) return s
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

export function exportarCSV(filename, rows, headers) {
  const escape = (val) => {
    const s = neutralizarFormulaCsv(val)
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const headerLine = headers.map((h) => escape(h.label)).join(',')
  const lines = rows.map((row) => headers.map((h) => escape(row[h.key])).join(','))
  const csv = [headerLine, ...lines].join('\n')

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const FIELD_ALIASES = {
  nombre: ['nombre', 'contacto', 'name', 'contact_name'],
  negocio: ['negocio', 'empresa', 'business', 'company'],
  email: ['email', 'e-mail', 'correo', 'correo_electronico'],
  telefono: ['telefono', 'teléfono', 'phone', 'whatsapp', 'celular'],
  pais: ['pais', 'país', 'country'],
  idioma: ['idioma', 'language', 'lenguaje'],
  rubro: ['rubro', 'vertical', 'industry', 'categoria'],
  fuente: ['fuente', 'source', 'canal', 'origen'],
  url: ['url', 'sitio_web', 'sitio', 'website', 'web'],
  notas: ['notas', 'nota', 'notes', 'observaciones'],
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

// Detectar el separador sólo en el primer registro, fuera de sus comillas.
function csvDelimiter(text) {
  let quoted = false; let commas = 0; let semicolons = 0; let started = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { index += 1; continue }
      quoted = !quoted
    }
    if (!quoted && (char === '\r' || char === '\n')) {
      if (started) break
      continue
    }
    if (char.trim()) started = true
    if (!quoted && char === ',') commas += 1
    if (!quoted && char === ';') semicolons += 1
  }
  return semicolons > commas ? ';' : ','
}

// Un salto de línea dentro de comillas pertenece al campo, no crea otro lead.
// Los errores sintácticos invalidan el archivo completo: no devolver un prefijo
// que el consumidor pudiera importar como si fuera un archivo válido.
function csvRecords(text, delimiter) {
  const records = []
  let values = []; let current = ''; let state = 'field'
  let line = 1; let recordLine = 1; let hasContent = false
  const finishField = () => { values.push(current.trim()); current = ''; state = 'field' }
  const finishRecord = () => {
    finishField()
    if (hasContent) records.push({ values, line: recordLine })
    values = []; hasContent = false
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const newline = char === '\n' || char === '\r'
    if (state === 'quoted') {
      if (char === '"') {
        if (text[index + 1] === '"') { current += '"'; index += 1 }
        else state = 'afterQuote'
      } else {
        current += char
        if (newline) {
          if (char === '\r' && text[index + 1] === '\n') { current += '\n'; index += 1 }
          line += 1
        }
      }
      continue
    }
    if (char === delimiter) { hasContent = true; finishField(); continue }
    if (newline) {
      finishRecord()
      if (char === '\r' && text[index + 1] === '\n') index += 1
      line += 1; recordLine = line
      continue
    }
    if (state === 'afterQuote') {
      if (char === ' ' || char === '\t') continue
      return { records: [], error: { row: line, message: 'Hay texto después del cierre de un campo entre comillas.' } }
    }
    if (char === '"' && !current.trim()) {
      current = ''; state = 'quoted'; hasContent = true
    } else {
      current += char
      if (char.trim()) hasContent = true
    }
  }
  if (state === 'quoted') return { records: [], error: { row: recordLine, message: 'Hay un campo con comillas sin cerrar.' } }
  finishRecord()
  return { records, error: null }
}

export function isDangerousCsvValue(value) {
  return /^[=+@-]/.test(String(value || '').trim())
}

export function parseLeadsCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '')
  const { records, error } = csvRecords(source, csvDelimiter(source))
  if (error) return { headers: [], rows: [], errors: [error] }
  if (!records.length) return { headers: [], rows: [], errors: [{ row: 1, message: 'El archivo está vacío.' }] }
  const originalHeaders = records[0].values
  if (records.length > 501) return { headers: originalHeaders, rows: [], errors: [{ row: records[501].line, message: 'El CSV no puede superar 500 contactos. Dividí el archivo antes de importar.' }] }
  // Columnas sobrantes vacías (p. ej. una coma final) no parten un contacto.
  const extra = records.slice(1).find((record) => record.values.slice(originalHeaders.length).some((value) => value !== ''))
  if (extra) return { headers: originalHeaders, rows: [], errors: [{ row: extra.line, message: 'Hay más columnas que en el encabezado. Revisá los separadores y las comillas.' }] }
  const normalized = originalHeaders.map(normalizeHeader)
  const mapping = {}
  Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
    // Los alias se normalizan igual que los encabezados: "E-mail" llega como
    // "e_mail" y antes no coincidía con el alias 'e-mail' (se perdía la columna).
    const index = normalized.findIndex((header) => aliases.some((alias) => normalizeHeader(alias) === header))
    if (index >= 0) mapping[field] = index
  })
  const errors = []; const warnings = []
  const rows = records.slice(1).map(({ values, line }) => {
    const row = {}; const formulaFields = []
    Object.keys(FIELD_ALIASES).forEach((field) => { row[field] = mapping[field] == null ? '' : values[mapping[field]] || ''; if (field !== 'telefono' && isDangerousCsvValue(row[field])) formulaFields.push(field); if (field === 'telefono' && /^[=@]/.test(row[field].trim())) formulaFields.push(field) })
    if (formulaFields.length) errors.push({ row: line, message: `Valor no permitido en ${formulaFields.join(', ')}.` })
    if (!row.nombre.trim() || !row.negocio.trim()) errors.push({ row: line, message: 'Nombre y negocio son obligatorios.' })
    if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) errors.push({ row: line, message: 'Email inválido.' })
    if (!row.pais.trim()) warnings.push({ row: line, message: 'País faltante: se importará sin país.' })
    if (!row.idioma.trim()) warnings.push({ row: line, message: 'Idioma faltante: se usará es.' })
    return row
  })
  return { headers: originalHeaders, mapping, rows, errors, warnings }
}
