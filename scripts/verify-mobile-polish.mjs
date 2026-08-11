import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { formatFechaVisible } from '../src/lib/text.js'

const root = process.cwd()
const read = (file) => readFile(path.join(root, file), 'utf8')

assert.equal(formatFechaVisible('2026-08-03'), '03/08/2026')
assert.equal(formatFechaVisible('2026-08-03T10:30:00'), '03/08/2026')
assert.equal(formatFechaVisible(''), '—')

const calendar = await read('src/components/Calendar.jsx')
const agendaStyles = await read('src/components/agenda.css')
const patients = await read('src/components/Patients.jsx')
const managementStyles = await read('src/components/management.css')
const markdown = await read('src/components/SafeMarkdown.jsx')
const messages = await read('src/components/Messages.jsx')

assert.match(calendar, /calendar-mobile-days/)
assert.match(calendar, /onNewTurno\?\./)
assert.match(agendaStyles, /@media \(max-width: 520px\)/)
assert.match(agendaStyles, /\.calendar-mobile-day-add \{ width: 44px; height: 44px;/)
assert.match(patients, /formatFechaVisible\(p\.ultima_visita\)/)
assert.match(patients, /client-mobile-card/)
assert.match(managementStyles, /\.client-mobile-card \{/)
assert.match(managementStyles, /\.messages-grid-full \.bubble \{/)
assert.match(markdown, /export function stripMarkdown/)
assert.doesNotMatch(markdown, /dangerouslySetInnerHTML/)
assert.match(messages, /<SafeMarkdown value=\{m\.texto\}/)
assert.match(messages, /stripMarkdown\(/)

console.log('Mobile polish checks passed')
