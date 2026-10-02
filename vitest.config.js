import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

// Suite unitaria y de componentes (Vitest + Testing Library). Convive con los
// scripts `scripts/verify-*.mjs` de `npm test`; no los reemplaza.
export default mergeConfig(viteConfig, defineConfig({
  // Los tests nunca leen .env/.env.local: un VITE_SUPABASE_URL real no debe
  // terminar en un cliente de Supabase durante la suite.
  envDir: false,
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    setupFiles: ['./src/test/setup.js'],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
}))
