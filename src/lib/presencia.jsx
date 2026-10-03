import { useEffect, useState } from 'react'

export const DURACION_SALIDA_MS = 160

function movimientoReducido() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Mantiene montado un elemento durante su animación de salida. Devuelve el
// último valor "abierto" (para seguir renderizando el contenido mientras se
// va) y si está saliendo. Con movimiento reducido cierra al instante.
export function usePresencia(valor, ms = DURACION_SALIDA_MS) {
  const [retenido, setRetenido] = useState(valor)
  const [saliendo, setSaliendo] = useState(false)

  useEffect(() => {
    if (valor) {
      setRetenido(valor)
      setSaliendo(false)
      return undefined
    }
    if (movimientoReducido()) {
      setRetenido(valor)
      setSaliendo(false)
      return undefined
    }
    setSaliendo(true)
    const timer = window.setTimeout(() => {
      setRetenido(valor)
      setSaliendo(false)
    }, ms)
    return () => window.clearTimeout(timer)
  }, [valor, ms])

  return { valor: valor || retenido, saliendo: !valor && Boolean(retenido) && saliendo }
}

// Envuelve un modal que se abre con una prop (open, turno, paciente…) para que
// tenga animación de salida sin tocar su lógica interna.
export function conPresencia(Componente, prop) {
  function ConPresencia(props) {
    const { valor, saliendo } = usePresencia(props[prop])
    if (!valor) return null
    return (
      <div className={`presencia${saliendo ? ' presencia--saliendo' : ''}`} style={{ display: 'contents' }} aria-hidden={saliendo || undefined}>
        <Componente {...props} {...{ [prop]: valor }} />
      </div>
    )
  }
  ConPresencia.displayName = `ConPresencia(${Componente.displayName || Componente.name || 'Modal'})`
  return ConPresencia
}
