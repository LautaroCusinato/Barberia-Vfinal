export function exportarCSV(filename, rows, headers) {
  const escape = (val) => {
    const s = String(val ?? '')
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
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

function parseLine(line, delimiter) {
  const values = []; let current = ''; let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && line[index + 1] === '"' && quoted) { current += '"'; index += 1; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (char === delimiter && !quoted) { values.push(current.trim()); current = ''; continue }
    current += char
  }
  values.push(current.trim())
  return values
}

export function isDangerousCsvValue(value) {
  return /^[=+@-]/.test(String(value || '').trim())
}

export function parseLeadsCsv(text) {
  const rawLines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (!rawLines.length) return { headers: [], rows: [], errors: [{ row: 1, message: 'El archivo está vacío.' }] }
  const delimiter = (rawLines[0].match(/;/g) || []).length > (rawLines[0].match(/,/g) || []).length ? ';' : ','
  const originalHeaders = parseLine(rawLines[0], delimiter)
  const normalized = originalHeaders.map(normalizeHeader)
  const mapping = {}
  Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
    const index = normalized.findIndex((header) => aliases.includes(header))
    if (index >= 0) mapping[field] = index
  })
  const errors = []
  const rows = rawLines.slice(1).map((line, rowIndex) => {
    const values = parseLine(line, delimiter); const row = {}; const formulaFields = []
    Object.keys(FIELD_ALIASES).forEach((field) => { row[field] = mapping[field] == null ? '' : values[mapping[field]] || ''; if (field !== 'telefono' && isDangerousCsvValue(row[field])) formulaFields.push(field); if (field === 'telefono' && /^[=@]/.test(row[field].trim())) formulaFields.push(field) })
    if (formulaFields.length) errors.push({ row: rowIndex + 2, message: `Valor no permitido en ${formulaFields.join(', ')}.` })
    if (!row.nombre.trim() || !row.negocio.trim()) errors.push({ row: rowIndex + 2, message: 'Nombre y negocio son obligatorios.' })
    if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) errors.push({ row: rowIndex + 2, message: 'Email inválido.' })
    return row
  })
  return { headers: originalHeaders, mapping, rows, errors }
}
