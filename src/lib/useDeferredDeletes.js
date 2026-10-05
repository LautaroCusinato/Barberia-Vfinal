import { useCallback, useLayoutEffect, useReducer, useRef } from 'react'
import { crearBorradosDiferidos } from './deferredDeletes.js'

export function useDeferredDeletes(contexto) {
  const [, actualizar] = useReducer((n) => n + 1, 0)
  const ref = useRef(null)
  useLayoutEffect(() => {
    const cola = crearBorradosDiferidos({ onChange: actualizar })
    ref.current = { contexto, cola }
    const protegerSalida = (event) => {
      if (!cola.pendiente()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protegerSalida)
    return () => {
      window.removeEventListener('beforeunload', protegerSalida)
      cola.cerrar()
      if (ref.current?.cola === cola) ref.current = null
    }
  }, [contexto])
  const programar = useCallback((opciones) => ref.current?.contexto === contexto ? ref.current.cola.programar(opciones) : null, [contexto])
  const filtrar = useCallback((tabla, filas) => ref.current?.contexto === contexto ? ref.current.cola.filtrar(tabla, filas) : filas, [contexto])
  return { programar, filtrar }
}
