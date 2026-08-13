import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const read = (file) => readFile(path.join(root, file), 'utf8')

const main = await read('src/main.jsx')
const app = await read('src/App.jsx')
const wizard = await read('src/pages/OnboardingWizard.jsx')
const transition = await read('src/components/WorkspacePreparing.jsx')
const polish = await read('src/components/polish.css')
const transitionStore = await read('src/lib/workspaceTransition.js')

assert.match(wizard, /saveWorkspacePreference\('business', data\.barberia_id\)/)
assert.match(wizard, /markWorkspaceTransition\(\)/)
assert.match(wizard, /window\.location\.assign\('\/'\)/)

assert.match(main, /WorkspacePreparing/)
assert.match(main, /hasWorkspaceTransition/)
assert.match(main, /workspaceTransition \? <WorkspacePreparing \/>/)
assert.match(main, /await resolverBarberia\(session\.user\.id\)/)
assert.match(main, /clearWorkspaceTransition\(\)/)
assert.match(main, /setWorkspaceTransition\(false\)/)
assert.match(transitionStore, /WORKSPACE_TRANSITION_KEY/)
assert.match(transitionStore, /60_000/)

assert.match(app, /loadedForTenant/)
assert.match(app, /setLoadedForTenant\(null\)/)
assert.match(app, /setLoadedForTenant\(barberiaId\)/)
assert.match(app, /Promise\.all\(\[/)
assert.match(app, /cargarMensajes\(clientesPromise\)/)
assert.match(app, /const secondaryPromise = Promise\.all\(\[cargarNotas\(\), mensajesPromise\]\)/)
assert.match(app, /loading \|\| loadedForTenant !== barberiaId/)
assert.doesNotMatch(app, /cargarMensajes\(\)\s*\n\s*await Promise\.all\(\[\s*cargarTurnos\(\),\s*cargarMensajes\(/)

assert.match(transition, /role="status"/)
assert.match(transition, /aria-live="polite"/)
assert.match(transition, /aria-busy="true"/)
assert.match(polish, /\.workspace-preparing\s*\{/)
assert.match(polish, /env\(safe-area-inset-bottom/)
assert.match(polish, /prefers-reduced-motion/)

console.log('Workspace transition checks passed')
