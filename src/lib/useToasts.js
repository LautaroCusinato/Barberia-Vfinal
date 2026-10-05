import { useCallback, useEffect, useRef, useState } from 'react'
import { reportClientError } from './observability.js'

const SALIDA_MS = 160
let secuencia = 0

// Cola de avisos breves. Cada aviso puede tener `onUndo` (botón "Deshacer")
// y `onExpire` (se ejecuta al vencer, al confirmar con su botón de cierre o
// al ser desplazado cuando todos los avisos visibles ofrecen Deshacer).
// Al salir se descarta con onDiscard: iniciar una petición durante
// pagehide/desmontaje no garantiza que llegue al servidor.
export function useToasts({ max = 2, contexto = null } = {}) {
  const [toasts, setToasts] = useState([])
  const entradas = useRef(new Map())
  const salidas = useRef(new Set())
  const montado = useRef(false)

  const cerrar = useCallback((id, motivo = 'expire') => {
    const entrada = entradas.current.get(id)
    if (!entrada) return
    entradas.current.delete(id)
    clearTimeout(entrada.timer)
    if (montado.current) {
      if (motivo === 'discard') setToasts((prev) => prev.filter((t) => t.id !== id))
      else {
        setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, saliendo: true } : t)))
        const timer = setTimeout(() => {
          salidas.current.delete(timer)
          if (montado.current) setToasts((prev) => prev.filter((t) => t.id !== id))
        }, SALIDA_MS)
        salidas.current.add(timer)
      }
    }
    const callback = motivo === 'undo' ? entrada.onUndo : motivo === 'discard' ? entrada.onDiscard : entrada.onExpire
    try {
      Promise.resolve(callback?.()).catch((error) => reportClientError(error, { source: 'toast_callback' }))
    } catch (error) { reportClientError(error, { source: 'toast_callback' }) }
  }, [])

  const mostrar = useCallback(({ mensaje, onUndo, onExpire, onDiscard, labelCerrar = 'Cerrar aviso', duracion = 4000 }) => {
    if (!montado.current) return null
    const id = ++secuencia
    const timer = setTimeout(() => cerrar(id, 'expire'), duracion)
    entradas.current.set(id, { onUndo, onExpire, onDiscard, timer })
    setToasts((prev) => [...prev, { id, mensaje, duracion, labelCerrar, deshacer: Boolean(onUndo) }])
    // Primero salen los avisos informativos. Si todos ofrecen Deshacer, el más
    // viejo se cierra como si hubiera vencido: un borrado pedido no se revierte
    // en silencio por mostrar otro aviso.
    while (entradas.current.size > max) {
      const activos = [...entradas.current.entries()]
      const informativo = activos.find(([, entrada]) => !entrada.onUndo)
      if (informativo) cerrar(informativo[0], 'discard')
      else cerrar(activos[0][0], 'expire')
    }
    return id
  }, [cerrar, max])

  useEffect(() => {
    montado.current = true
    setToasts([])
    const timersSalida = salidas.current
    const descartarPendientes = () => {
      for (const id of [...entradas.current.keys()]) cerrar(id, 'discard')
      for (const timer of timersSalida) clearTimeout(timer)
      timersSalida.clear()
      if (montado.current) setToasts([])
    }
    window.addEventListener('pagehide', descartarPendientes)
    return () => {
      window.removeEventListener('pagehide', descartarPendientes)
      montado.current = false
      descartarPendientes()
    }
  }, [cerrar, contexto])

  return { toasts, mostrar, cerrar }
}
