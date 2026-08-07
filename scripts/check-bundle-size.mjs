import fs from 'node:fs'
import path from 'node:path'

const dist = path.resolve('dist/assets')
const files = fs.readdirSync(dist).filter((name) => /\.(js|css)$/.test(name)).map((name) => ({ name, bytes: fs.statSync(path.join(dist, name)).size }))
const initialJs = files.filter((file) => file.name.startsWith('index-') && file.name.endsWith('.js')).reduce((sum, file) => sum + file.bytes, 0)
const maxInitialJs = Number(process.env.MAX_INITIAL_JS_BYTES || 600_000)
if (initialJs > maxInitialJs) {
  console.error(`Bundle inicial supera el límite: ${initialJs} > ${maxInitialJs} bytes.`)
  process.exit(1)
}
console.log(`Bundle size OK: initial_js=${initialJs} bytes, limit=${maxInitialJs}.`)
