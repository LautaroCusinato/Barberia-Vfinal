import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

const hasRealCredentials =
  url &&
  key &&
  !url.includes('tu-proyecto.supabase.co') &&
  key !== 'tu-anon-key-publica'

// Si no cargaste las variables de entorno todavia, el dashboard sigue
// funcionando con datos de ejemplo (ver src/data/mockData.js).
// Apenas completes .env con tu proyecto real de Supabase, esto se activa solo.
export const isSupabaseConfigured = Boolean(hasRealCredentials)

export const supabase = isSupabaseConfigured ? createClient(url, key) : null
