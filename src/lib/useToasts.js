import { useCallback, useEffect, useRef, useState } from 'react'

const SALIDA_MS = 160
let secuencia = 0

// Cola de avisos breves. Cada aviso puede tener `onUndo` (botón "Deshacer")
// y `onExpire` (se ejecuta al vencer, al cerrarlo, al ser desplazado por uno
// nuevo o al salir de la página). Así un borrado diferido nunca queda colgado.
export function useToasts({ max = 2 } = {}) {
  const [toasts, setToasts] = useState([])
  const entradas = useRef(new Map())

  const cerrar = useCallback((id, motivo = 'expire') => {
    const entrada = entradas.current.get(id)
    if (!entrada) return
    entradas.current.delete(id)
    clearTimeout(entrada.timer)
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, saliendo: true } : t)))
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), SALIDA_MS)
    if (motivo === 'undo') entrada.onUndo?.()
    else entrada.onExpire?.()
  }, [])

  const mostrar = useCallback(({ mensaje, onUndo, onExpire, duracion = 4000 }) => {
    const id = ++secuencia
    const timer = setTimeout(() => cerrar(id, 'expire'), duracion)
    entradas.current.set(id, { onUndo, onExpire, timer })
    setToasts((prev) => [...prev, { id, mensaje, duracion, deshacer: Boolean(onUndo) }])
    const activos = [...entradas.current.keys()]
    while (activos.length > max) cerrar(activos.shift(), 'expire')
    return id
  }, [cerrar, max])

  useEffect(() => {
    const confirmarPendientes = () => [...entradas.current.keys()].forEach((id) => cerrar(id, 'expire'))
    window.addEventListener('pagehide', confirmarPendientes)
    return () => {
      window.removeEventListener('pagehide', confirmarPendientes)
      confirmarPendientes()
    }
  }, [cerrar])

  return { toasts, mostrar, cerrar }
}
