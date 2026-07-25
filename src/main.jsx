import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import Login from './components/Login.jsx'
import { supabase, isSupabaseConfigured } from './lib/supabaseClient'
import './index.css'

function Root() {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setChecking(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setAuthed(Boolean(data.session))
      setChecking(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(Boolean(session))
    })

    return () => listener?.subscription?.unsubscribe()
  }, [])

  if (checking) return null
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
