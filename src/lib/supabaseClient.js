import { createClient } from '@supabase/supabase-js'
import { fetchConProgreso } from './progress.js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseUrl = url || ''

const hasRealCredentials =
  url &&
  key &&
  !url.includes('tu-proyecto.supabase.co') &&
  key !== 'tu-anon-key-publica'

export const isSupabaseConfigured = Boolean(hasRealCredentials)

export const supabase = isSupabaseConfigured ? createClient(url, key, { global: { fetch: fetchConProgreso } }) : null
