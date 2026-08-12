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
const settings = read('src/components/TenantSettings.jsx')

assert.match(main, /path === '\/auth\/confirm'/)
assert.match(main, /LandingFallback/)
assert.match(callback, /exchangeCodeForSession/)
assert.match(callback, /token_hash/)
assert.match(callback, /verifyOtp/)
assert.match(callback, /setSession/)
assert.match(callback, /safeAuthNext/)
assert.match(callback, /resendCooldown/)
assert.match(callback, /sanitizeAuthError/)
for (const source of [signup, recovery, wizard, security]) {
  assert.match(source, /buildAuthRedirect/)
  assert.doesNotMatch(source, /window\.location\.origin.*(?:redirectTo|emailRedirectTo)/)
}
assert.match(redirects, /barberia\.cuchitron\.lat/)
assert.match(redirects, /configured === PRODUCTION_ORIGIN/)
assert.match(redirects, /import\.meta\.env\?\.DEV/)
assert.match(redirects, /candidate\.startsWith\('\/'\)/)
assert.match(redirects, /candidate\.startsWith\('\/\/'\)/)
assert.match(read('.gitignore'), /\.env\.e2e\.local/)
assert.match(settings, /getAppOrigin/)
assert.doesNotMatch(settings, /window\.location\.origin.*invitacion/)

for (const template of ['confirm-signup.html', 'reset-password.html', 'change-email.html', 'invite-user.html']) {
  const source = read(`docs/auth-templates/${template}`)
  assert.match(source, /\.SiteURL/)
  assert.match(source, /\.TokenHash/)
  assert.doesNotMatch(source, /\.ConfirmationURL/)
}

console.log(JSON.stringify({ auth_callback: 'present', token_hash_verification: 'present', redirect_allowlist: 'present', production_origin: 'explicit', raw_auth_errors: 'blocked', resend_cooldown: 'present', branded_templates: 'present' }, null, 2))
