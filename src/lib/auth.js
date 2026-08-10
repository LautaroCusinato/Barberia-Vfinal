import { supabase, isSupabaseConfigured } from './supabaseClient'

export async function logout() {
  if (isSupabaseConfigured) await supabase.auth.signOut()
}
