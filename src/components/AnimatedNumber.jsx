import { useEffect, useState } from 'react'

const prefersReducedMotion = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
)

const EXIT_FALLBACK_MS = 400

// Número "rodante": cuando cambia el valor, el anterior sale hacia arriba y el
// nuevo entra desde abajo. Nunca anima al montar (cambiar de pantalla no debe
// disparar el efecto). Acepta valores ya formateados ("$ 8.500", "67%").
export default function AnimatedNumber({ value, className = '' }) {
  const text = value == null ? '' : String(value)
  const [state, setState] = useState({ current: text, previous: null, key: 0 })

  // Derivado durante el render (patrón recomendado por React para estado que
  // depende de props): evita un frame con el valor viejo.
  if (text !== state.current) {
    setState({
      current: text,
      previous: prefersReducedMotion() ? null : state.current,
      key: state.key + 1,
    })
  }

  const { previous, key } = state
  useEffect(() => {
    if (previous == null) return undefined
    // Red de seguridad por si animationend no llega (pestaña oculta, etc.).
    const id = window.setTimeout(() => {
      setState((s) => (s.key === key ? { ...s, previous: null } : s))
    }, EXIT_FALLBACK_MS)
    return () => window.clearTimeout(id)
  }, [previous, key])

  const clearPrevious = () => setState((s) => (s.key === key ? { ...s, previous: null } : s))
  const animating = previous != null

  return (
    <span className={`rolling-number${className ? ` ${className}` : ''}`}>
      <span key={key} className={`rolling-number__value${animating ? ' rolling-number__value--enter' : ''}`}>
        {state.current}
      </span>
      {animating && (
        <span
          key={`prev-${key}`}
          className="rolling-number__value rolling-number__value--exit"
          aria-hidden="true"
          onAnimationEnd={clearPrevious}
        >
          {previous}
        </span>
      )}
    </span>
  )
}
