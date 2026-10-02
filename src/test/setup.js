import { afterEach, vi } from 'vitest'

// Ningún test habla con Supabase. Un test que necesite un cliente concreto
// puede declarar su propio vi.mock de este módulo.
vi.mock('/src/lib/supabaseClient.js', () => ({
  supabase: null,
  supabaseUrl: '',
  isSupabaseConfigured: false,
}))

afterEach(() => {
  vi.useRealTimers()
  if (typeof window === 'undefined') return
  try {
    window.localStorage.clear()
    window.sessionStorage.clear()
  } catch {
    // Storage bloqueado: no hay nada que limpiar.
  }
})
