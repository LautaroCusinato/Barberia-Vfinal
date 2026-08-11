import { getQaConfig, printGuardError } from './e2e-sandbox-guards.mjs'

try {
  const config = getQaConfig()
  console.log(JSON.stringify({
    ready: true,
    environment: config.environment,
    project_ref_configured: true,
    runtime_project_ref: config.runtimeProjectRef,
    project_ref_is_not_production: config.projectRef !== 'ssagttjdgtypxjcgdnrw',
    url_matches_project_ref: true,
    auth_isolated: true,
    external_providers_disabled: true,
    cleanup_requires_explicit_execute: true,
    fixture_prefix: config.testPrefix,
  }, null, 2))
} catch (error) {
  printGuardError(error)
  process.exitCode = 2
}
