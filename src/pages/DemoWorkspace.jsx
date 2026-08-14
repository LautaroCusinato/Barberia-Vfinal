import { useMemo } from 'react'
import App from '../App.jsx'
import { getDemoSession } from '../lib/demoStore.js'

export default function DemoWorkspace() {
  const sessionId = useMemo(() => getDemoSession(), [])
  return <App demoMode demoSessionId={sessionId} barberiaId={`demo-${sessionId}`} barberiaNombre="Barbería Demo Austral" vertical="barberia" />
}
