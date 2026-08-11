import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  WORKSPACE_PREFERENCE_KEY,
  clearWorkspacePreference,
  parseWorkspacePreference,
  readWorkspacePreference,
  saveWorkspacePreference,
} from '../src/lib/workspacePreference.js'
import { isNearBottom, shouldFollowNewMessages } from '../src/lib/chatScroll.js'

const root = process.cwd()
const read = (file) => readFile(path.join(root, file), 'utf8')

const storage = {
  values: new Map(),
  getItem(key) { return this.values.get(key) ?? null },
  setItem(key, value) { this.values.set(key, value) },
  removeItem(key) { this.values.delete(key) },
}

assert.deepEqual(parseWorkspacePreference('{"type":"platform"}'), { type: 'platform' })
assert.deepEqual(parseWorkspacePreference('{"type":"business","tenantId":6}'), { type: 'business', tenantId: '6' })
assert.equal(parseWorkspacePreference('{"type":"business","tenantId":"not-a-tenant"}'), null)
assert.equal(parseWorkspacePreference('{"type":"other"}'), null)

assert.equal(saveWorkspacePreference('business', 6, storage), true)
assert.deepEqual(readWorkspacePreference(storage), { type: 'business', tenantId: '6' })
assert.equal(saveWorkspacePreference('platform', null, storage), true)
assert.deepEqual(readWorkspacePreference(storage), { type: 'platform' })
clearWorkspacePreference(storage)
assert.equal(readWorkspacePreference(storage), null)
assert.equal(WORKSPACE_PREFERENCE_KEY, 'austral-selected-workspace')

// Chat A-G: initial/open, near-bottom, manual scroll, own message, threshold,
// safe rendering and no timer-driven jumps.
assert.equal(shouldFollowNewMessages({ wasAtBottom: true }), true) // A
assert.equal(shouldFollowNewMessages({ wasAtBottom: false }), false) // B
assert.equal(shouldFollowNewMessages({ wasAtBottom: false, ownMessage: true }), true) // C
assert.equal(isNearBottom({ scrollTop: 800, scrollHeight: 1200, clientHeight: 260 }), false) // D
assert.equal(isNearBottom({ scrollTop: 945, scrollHeight: 1200, clientHeight: 260 }), true) // E

const messages = await read('src/components/Messages.jsx')
const main = await read('src/main.jsx')
const indexCss = await read('src/index.css')
const safeMarkdown = await read('src/components/SafeMarkdown.jsx')

assert.match(messages, /useLayoutEffect/)
assert.match(messages, /messagesEndRef/)
assert.match(messages, /isNearBottom\(/)
assert.match(messages, /shouldFollowNewMessages\(/)
assert.match(messages, /showNewMessages/)
assert.match(messages, /<SafeMarkdown value=\{m\.texto\}/)
assert.doesNotMatch(messages, /setInterval\(|setTimeout\(/) // F/G
assert.match(main, /readWorkspacePreference\(/)
assert.match(main, /saveWorkspacePreference\('platform'\)/)
assert.match(main, /saveWorkspacePreference\('business'/)
assert.match(main, /clearWorkspacePreference\(/)
assert.match(main, /await resolverBarberia\(session\.user\.id\)/)
assert.match(main, /barberia_members/)
assert.match(main, /platform_members/)
assert.match(indexCss, /\.new-messages-button/)
assert.match(indexCss, /scroll-padding-bottom: calc\(1rem \+ var\(--safe-bottom\)\)/)
assert.doesNotMatch(safeMarkdown, /dangerouslySetInnerHTML/)

// Workspace A-H: allowlist, persistence, revalidation contract and cleanup.
assert.deepEqual(parseWorkspacePreference({ type: 'platform', token: 'never-persist' }), { type: 'platform' }) // A
assert.deepEqual(parseWorkspacePreference({ type: 'business', tenantId: '6', access_token: 'never-persist' }), { type: 'business', tenantId: '6' }) // B
assert.equal(parseWorkspacePreference({ type: 'business', tenantId: 0 }), null) // C
assert.equal(saveWorkspacePreference('business', 6, storage), true) // D
assert.deepEqual(readWorkspacePreference(storage), { type: 'business', tenantId: '6' }) // E
assert.equal(saveWorkspacePreference('platform', null, storage), true) // F
clearWorkspacePreference(storage) // G
assert.equal(readWorkspacePreference(storage), null) // H
assert.doesNotMatch(main, /sessionStorage\.setItem\([^,]+,.*workspace/i)

console.log('Mobile session/chat fix checks passed')
