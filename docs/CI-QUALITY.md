# CI / Quality

## Separación de entornos

### Public CI

El workflow `.github/workflows/ci.yml` debe poder ejecutarse sin `.env.e2e.local`, service role, passwords QA, SSH, Evolution, DeepSeek, Mercado Pago ni n8n. Ejecuta:

1. `npm ci`
2. `npm run lint`
3. `npm test`
4. `npm run build`
5. `node scripts/scan-secrets.mjs`
6. `node scripts/check-bundle-size.mjs`
7. Playwright Chromium con su `webServer` local

Los escenarios que requieren Supabase real se mantienen omitidos hasta que el job QA autorizado sea habilitado con sus secretos de Actions. Un escenario omitido no se presenta como ejecutado.

### Private QA

El job QA debe ser separado y condicionado a las variables/secretos de QA (`E2E_REAL_SUPABASE=1`, `E2E_ENVIRONMENT=qa`, ref `cmsymmszlzikqpvfqjre`, claves QA y password QA). Los guards abortan si el ref o la URL coinciden con `ssagttjdgtypxjcgdnrw`.

No se conectan proveedores externos, WhatsApp, Evolution, n8n o billing real.

## Concurrencia

Se agrega `concurrency` por workflow y ref con `cancel-in-progress: true`. Esto cancela ejecuciones obsoletas del mismo branch, pero no mezcla ejecuciones entre ramas.

## Diagnóstico reproducible

La revisión local reproduce los mismos comandos del workflow en Node 20, con `npm ci` y el lockfile versionado. Si un check vuelve a fallar, revisar el step exacto en este orden: instalación, lint, verificadores, build, secret scan, bundle, instalación Chromium y Playwright. No usar `continue-on-error`, sleeps arbitrarios ni eliminar tests para ocultar una falla.

Desde este entorno no fue posible consultar los logs privados de GitHub Actions: `gh` no está instalado y la API de Actions no está accesible sin una sesión/connector autorizado. Por eso no se afirma una causa remota no observada; la configuración queda endurecida y debe verificarse en el próximo run real.
