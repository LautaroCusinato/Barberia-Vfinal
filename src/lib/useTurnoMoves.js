import { useCallback, useLayoutEffect, useRef } from 'react'
import { confirmarMovimiento, crearColaMovimientos } from './turnoMoves.js'

// La cola vive sólo durante este contexto de negocio/demo. Sus callbacks
// consultan el último render, sin capturar una lista de turnos antigua.
export function useTurnoMoves({ contexto, ...opciones }) {
  const opcionesRef = useRef(null)
  const colaRef = useRef(null)
  useLayoutEffect(() => { opcionesRef.current = opciones })
  useLayoutEffect(() => {
    const cola = crearColaMovimientos({
      leer: (id) => opcionesRef.current.turnos.find((t) => String(t.id) === String(id)),
      guardar: (...args) => opcionesRef.current.guardar(...args),
      confirmar: (id, origen, guardado) => {
        const opcionesActuales = opcionesRef.current
        const resultado = confirmarMovimiento(opcionesActuales.turnos, id, origen, guardado)
        if (!resultado.ok) return false
        if (resultado.turnos !== opcionesActuales.turnos) {
          // La siguiente operación puede empezar antes del render de React.
          opcionesRef.current = { ...opcionesActuales, turnos: resultado.turnos }
          opcionesActuales.setTurnos((turnos) => confirmarMovimiento(turnos, id, origen, guardado).turnos)
        }
        return true
      },
      onError: (error) => opcionesRef.current.onError(error),
      onObsoleto: () => opcionesRef.current.onObsoleto(),
      onMovido: (aviso) => opcionesRef.current.onMovido(aviso),
    })
    colaRef.current = { contexto, cola }
    return () => {
      cola.cerrar()
      if (colaRef.current?.cola === cola) colaRef.current = null
    }
  }, [contexto])

  const mover = useCallback((turno, destino) => colaRef.current?.contexto === contexto
    ? colaRef.current.cola.mover(turno.id, destino) : Promise.resolve(false), [contexto])
  const pendiente = useCallback((id) => colaRef.current?.contexto === contexto
    && colaRef.current.cola.pendiente(id), [contexto])
  const invalidar = useCallback((id) => {
    if (colaRef.current?.contexto === contexto) colaRef.current.cola.invalidar(id)
  }, [contexto])
  return { mover, pendiente, invalidar }
}
