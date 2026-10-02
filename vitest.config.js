import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

// Suite unitaria y de componentes (Vitest + Testing Library). Convive con los
// scripts `scripts/verify-*.mjs` de `npm test`; no los reemplaza.
//
// - `*.test.js`  -> entorno node (rápido). Si un módulo necesita APIs del
//   navegador (localStorage, window, document), el test lo declara con
//   `// @vitest-environment jsdom` en la primera línea.
// - `*.test.jsx` -> componentes React en jsdom con Testing Library.
export default mergeConfig(viteConfig, defineConfig({
  // Los tests nunca leen .env/.env.local: un VITE_SUPABASE_URL real no debe
  // terminar en un cliente de Supabase durante la suite.
  envDir: false,
  test: {
    // El primer arranque de jsdom puede tardar mucho en máquinas lentas o en CI
    // en frío; 5s por defecto generaba fallos intermitentes.
    testTimeout: 20000,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.js'],
          setupFiles: ['./src/test/setup.js'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.jsx'],
          setupFiles: ['./src/test/setup.js', './src/test/setup-dom.js'],
        },
      },
    ],
  },
}))
