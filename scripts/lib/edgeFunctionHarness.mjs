// Ejecuta una Edge Function de supabase/functions en Node, sin red ni Deno:
// quita los tipos TypeScript, reemplaza supabase-js por un cliente en memoria y
// captura el handler de Deno.serve. Es una simulación local para probar el
// cableado de cada función; no reemplaza una prueba contra Supabase/Evolution.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const sharedDir = path.join(root, 'supabase', 'functions', '_shared')
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-harness-'))
let moduleCounter = 0

const supabaseStub = path.join(workDir, 'supabase-js-stub.mjs')
fs.writeFileSync(supabaseStub, 'export function createClient() { return globalThis.__edgeHarnessDb.client() }\n')
const operatorStub = path.join(workDir, 'operator-stub.mjs')
fs.writeFileSync(operatorStub, 'export async function requireOperator() { return { user: { id: "operator-harness" } } }\n')

export const harnessEnv = new Map()
globalThis.Deno = {
  env: { get: (key) => (harnessEnv.has(key) ? harnessEnv.get(key) : undefined) },
  serve: (handler) => { globalThis.__edgeHarnessHandler = handler },
}

export async function loadEdgeFunction(name) {
  const source = fs.readFileSync(path.join(root, 'supabase', 'functions', name, 'index.ts'), 'utf8')
  const js = stripTypeScriptTypes(source)
    .replace(/from 'npm:@supabase\/supabase-js@[^']+'/g, `from '${pathToFileURL(supabaseStub).href}'`)
    .replace(/from '\.\.\/_shared\/supabase\.ts'/g, `from '${pathToFileURL(operatorStub).href}'`)
    .replace(/from '\.\.\/_shared\/([^']+)'/g, (_, file) => `from '${pathToFileURL(path.join(sharedDir, file)).href}'`)
  const file = path.join(workDir, `${name}-${moduleCounter += 1}.mjs`)
  fs.writeFileSync(file, js)
  globalThis.__edgeHarnessHandler = null
  await import(pathToFileURL(file).href)
  const handler = globalThis.__edgeHarnessHandler
  if (typeof handler !== 'function') throw new Error(`${name}: Deno.serve no registró un handler`)
  return async (body, headers = {}) => {
    const response = await handler(new Request('https://edge.local/', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }))
    return { status: response.status, body: await response.json() }
  }
}

export function senderHashFor(jid) {
  return `sha256:${createHash('sha256').update(jid).digest('hex').slice(0, 12)}`
}

/** Base en memoria con la API mínima de supabase-js que usan las funciones. */
export function createMemoryDb(tables = {}, { rpc = {} } = {}) {
  const db = { tables: structuredClone(tables), calls: [], failTables: new Set() }
  for (const name of ['saas_automation_shadow_runs', 'saas_automation_events', 'clientes', 'turnos', 'config']) db.tables[name] ||= []
  // Marcas crecientes en el pasado reciente: ordenan las corridas y siguen frescas.
  let clock = Date.now() - 10 * 60 * 1000
  db.tick = () => new Date(clock += 1000).toISOString()

  class Query {
    constructor(table) { this.table = table; this.filters = []; this.sort = null; this.max = null; this.values = null }
    select() { return this }
    eq(key, value) { this.filters.push((row) => String(row[key]) === String(value)); return this }
    in(key, values) { this.filters.push((row) => values.map(String).includes(String(row[key]))); return this }
    order(key, { ascending = true } = {}) { this.sort = { key, ascending }; return this }
    limit(count) { this.max = count; return this }
    update(values) { this.values = values; return this }
    rows() {
      let rows = (db.tables[this.table] || []).filter((row) => this.filters.every((filter) => filter(row)))
      if (this.sort) rows = [...rows].sort((a, b) => (String(a[this.sort.key]) < String(b[this.sort.key]) ? -1 : 1) * (this.sort.ascending ? 1 : -1))
      if (this.max !== null) rows = rows.slice(0, this.max)
      return rows
    }
    async maybeSingle() {
      db.calls.push({ table: this.table })
      if (db.failTables.has(this.table)) return { data: null, error: { message: 'forced_failure' } }
      const rows = this.rows()
      if (rows.length > 1) return { data: null, error: { message: 'multiple_rows' } }
      return { data: rows[0] ?? null, error: null }
    }
    then(resolve, reject) {
      db.calls.push({ table: this.table })
      if (db.failTables.has(this.table)) return Promise.resolve({ data: null, error: { message: 'forced_failure' } }).then(resolve, reject)
      const rows = this.rows()
      if (this.values) for (const row of rows) Object.assign(row, this.values)
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
    }
  }

  const rpcHandlers = {
    record_whatsapp_shadow_run(args) {
      const integration = (db.tables.saas_whatsapp_connections || []).find((row) => Number(row.integration_id) === Number(args.p_integration_id))
      const id = db.tables.saas_automation_shadow_runs.length + 1
      db.tables.saas_automation_shadow_runs.push({ id, tenant_id: integration?.barberia_id, integration_id: args.p_integration_id, event_id: args.p_event_id, intent: args.p_intent, metadata: args.p_metadata, observed_at: db.tick() })
      return [{ shadow_run_id: id }]
    },
    claim_whatsapp_event(args) {
      const existing = db.tables.saas_automation_events.find((row) => row.integration_id === args.p_integration_id && row.event_id === args.p_event_id)
      if (existing) return [{ acquired: false }]
      db.tables.saas_automation_events.push({ integration_id: args.p_integration_id, event_id: args.p_event_id, status: 'processing' })
      return [{ acquired: true }]
    },
    finish_whatsapp_event(args) {
      const row = db.tables.saas_automation_events.find((item) => item.integration_id === args.p_integration_id && item.event_id === args.p_event_id)
      if (row) Object.assign(row, { status: args.p_status, result_reference: args.p_result_reference })
      return Boolean(row)
    },
    ...rpc,
  }

  db.client = () => ({
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      db.calls.push({ rpc: name, args })
      const handler = rpcHandlers[name]
      if (!handler) return { data: null, error: { message: `rpc_not_stubbed:${name}` } }
      try { return { data: await handler(args, db), error: null } } catch (error) { return { data: null, error: { message: error.message, code: error.code } } }
    },
  })
  globalThis.__edgeHarnessDb = db
  return db
}
