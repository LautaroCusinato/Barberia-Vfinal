import { useCallback, useLayoutEffect, useReducer, useRef } from 'react'
import { crearBorradosDiferidos } from './deferredDeletes.js'

export function useDeferredDeletes(contexto) {
  const [version, actualizar] = useReducer((n) => n + 1, 0)
  const ref = useRef(null)
  // Misma lista filtrada mientras no cambien la base ni las marcas: las marcas
  // confirmadas se retienen, y filtrar en cada render rompería memos y efectos.
  const cache = useRef(new Map())
  useLayoutEffect(() => {
    const cola = crearBorradosDiferidos({ onChange: actualizar })
    ref.current = { contexto, cola }
    cache.current.clear()
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
  const filtrar = useCallback((tabla, filas) => {
    const actual = ref.current
    if (actual?.contexto !== contexto) return filas
    const previo = cache.current.get(tabla)
    if (previo && previo.filas === filas && previo.cola === actual.cola && previo.version === version) return previo.resultado
    const resultado = actual.cola.filtrar(tabla, filas)
    cache.current.set(tabla, { filas, cola: actual.cola, version, resultado })
    return resultado
  }, [contexto, version])
  return { programar, filtrar }
}
