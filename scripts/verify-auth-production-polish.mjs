import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const main = read('src/main.jsx')
const signup = read('src/pages/Signup.jsx')
const recovery = read('src/pages/PasswordRecovery.jsx')
const wizard = read('src/pages/OnboardingWizard.jsx')
const security = read('src/pages/AccountSecurity.jsx')
const callback = read('src/pages/AuthConfirm.jsx')
const redirects = read('src/lib/authRedirect.js')

assert.match(main, /path === '\/auth\/confirm'/)
assert.match(main, /LandingFallback/)
assert.match(callback, /exchangeCodeForSession/)
assert.match(callback, /setSession/)
assert.match(callback, /safeAuthNext/)
assert.match(callback, /sanitizeAuthError/)
for (const source of [signup, recovery, wizard, security]) {
  assert.match(source, /buildAuthRedirect/)
  assert.doesNotMatch(source, /window\.location\.origin.*(?:redirectTo|emailRedirectTo)/)
}
assert.match(redirects, /barberia\.cuchitron\.lat/)
assert.match(redirects, /candidate\.startsWith\('\/'\)/)
assert.match(redirects, /candidate\.startsWith\('\/\/'\)/)
assert.match(read('.gitignore'), /\.env\.e2e\.local/)

console.log(JSON.stringify({ auth_callback: 'present', redirect_allowlist: 'present', production_origin: 'explicit', raw_auth_errors: 'blocked' }, null, 2))
