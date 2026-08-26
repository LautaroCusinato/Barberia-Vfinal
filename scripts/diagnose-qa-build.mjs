const names = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_MERCADOPAGO_SANDBOX_PUBLIC_KEY',
  'VITE_APP_BASE_URL',
]

for (const name of names) {
  console.log(`${name}_PRESENT=${Boolean(process.env[name])}`)
}

console.log(`CF_PAGES=${process.env.CF_PAGES === '1' || process.env.CF_PAGES === 'true'}`)
console.log(`CF_PAGES_BRANCH=${process.env.CF_PAGES_BRANCH || ''}`)
console.log(`CF_PAGES_COMMIT_SHA=${process.env.CF_PAGES_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA_1 || ''}`)
