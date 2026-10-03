import { useEffect, useRef, useState } from 'react'
import { suscribirProgreso } from '../lib/progress.js'

const ESPERA_MS = 400

// Barra fina arriba de todo: aparece sólo si una operación supera los 400ms,
// avanza rápido hasta el 80% y se completa cuando termina.
export default function TopProgress() {
  const [fase, setFase] = useState('oculta') // oculta | avanzando | completa
  const timer = useRef(null)
  const visible = useRef(false)

  useEffect(() => suscribirProgreso((activas) => {
    if (activas > 0) {
      if (visible.current || timer.current) return
      timer.current = setTimeout(() => {
        timer.current = null
        visible.current = true
        setFase('avanzando')
      }, ESPERA_MS)
      return
    }
    clearTimeout(timer.current)
    timer.current = null
    if (!visible.current) return
    visible.current = false
    setFase('completa')
    setTimeout(() => setFase((f) => (f === 'completa' ? 'oculta' : f)), 420)
  }), [])

  if (fase === 'oculta') return null
  return <div className={`top-progress top-progress--${fase}`} role="progressbar" aria-label="Cargando" aria-busy={fase === 'avanzando'} />
}
