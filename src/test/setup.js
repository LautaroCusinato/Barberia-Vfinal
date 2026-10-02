import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Ningún test habla con Supabase. Un test que necesite un cliente concreto
// puede declarar su propio vi.mock de este módulo.
vi.mock('/src/lib/supabaseClient.js', () => ({
  supabase: null,
  supabaseUrl: '',
  isSupabaseConfigured: false,
}))

// jsdom no implementa scrollIntoView (lo usa el hilo de Mensajes).
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  try {
    globalThis.localStorage?.clear()
    globalThis.sessionStorage?.clear()
  } catch {
    // Storage bloqueado: no hay nada que limpiar.
  }
})
