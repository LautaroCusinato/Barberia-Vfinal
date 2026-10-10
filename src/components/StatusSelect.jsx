import { useLayoutEffect, useRef, useState } from 'react'
import { Check, CheckCircle2, X } from 'lucide-react'

// La barberia solo maneja 3 estados reales de un turno (a diferencia
// del panel dental original, que tenia pendiente/llego/en_atencion como
// pasos intermedios). Cualquier turno viejo que todavia tenga uno de esos
// estados heredados cae en "confirmado" por defecto (ver statusMeta),
// salvo 'cancelado' que se trata como 'no_asistio'.
export const STATUS_OPTIONS = [
  { value: 'confirmado', label: 'Confirmado', bg: 'var(--accent-soft)', color: 'var(--accent-strong)' },
  { value: 'atendido', label: 'Atendido', bg: 'var(--green-soft)', color: 'var(--green-text)' },
  { value: 'no_asistio', label: 'No asistió', bg: 'var(--rose-soft)', color: 'var(--rose-text)' },
]

const LEGACY_A_NO_ASISTIO = ['cancelado']

export function statusMeta(value) {
  const encontrado = STATUS_OPTIONS.find((o) => o.value === value)
  if (encontrado) return encontrado
  if (LEGACY_A_NO_ASISTIO.includes(value)) return STATUS_OPTIONS.find((o) => o.value === 'no_asistio')
  return STATUS_OPTIONS.find((o) => o.value === 'confirmado')
}

export default function StatusSelect({ value, onChange }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const meta = statusMeta(value)
  const confirmado = meta.value === 'confirmado'
  const atendido = meta.value === 'atendido'
  const ausente = meta.value === 'no_asistio'

  const groupRef = useRef(null)
  const pillRef = useRef(null)
  const buttonRefs = useRef({})
  const valueRef = useRef(meta.value)

  // Pastilla de fondo que se desliza hasta la opción elegida. La primera vez
  // se ubica sin transición; después anima al cambiar el valor. Si cambia el
  // tamaño del grupo (resize, fuentes, layout) se recoloca sin animar.
  const placePill = (animate) => {
    const pill = pillRef.current
    const button = buttonRefs.current[valueRef.current]
    if (!pill || !button || !button.offsetWidth) return
    const width = `${button.offsetWidth}px`
    const height = `${button.offsetHeight}px`
    const transform = `translate3d(${button.offsetLeft}px, ${button.offsetTop}px, 0)`
    // Sin cambios de geometría no tocamos nada: así una notificación del
    // ResizeObserver no corta una transición en curso.
    if (pill.style.width === width && pill.style.height === height && pill.style.transform === transform) return
    const instant = !animate || pill.dataset.ready !== 'true'
    if (instant) pill.style.transition = 'none'
    pill.style.width = width
    pill.style.height = height
    pill.style.transform = transform
    pill.dataset.ready = 'true'
    if (instant) {
      void pill.offsetWidth // aplica la posición sin transición antes de restaurarla
      pill.style.transition = ''
    }
  }

  useLayoutEffect(() => {
    valueRef.current = meta.value
    placePill(true)
  })

  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => placePill(false))
    observer.observe(group)
    Object.values(buttonRefs.current).forEach((button) => { if (button) observer.observe(button) })
    return () => observer.disconnect()
  }, []) // placePill lee todo desde refs: el observer se crea una sola vez.

  const change = async (nextValue) => {
    if (pending || nextValue === meta.value) return
    setPending(true)
    setError('')
    try {
      const saved = await onChange(nextValue)
      if (saved === false) setError('No se pudo actualizar el estado. Intentá de nuevo.')
    } catch {
      setError('No se pudo actualizar el estado. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div ref={groupRef} className="turno-status-actions turno-status-actions--pill" onClick={(e) => e.stopPropagation()} aria-busy={pending}>
      <span ref={pillRef} className={`turno-status-pill turno-status-pill--${meta.value}`} aria-hidden="true" />
      <button
        ref={(el) => { buttonRefs.current.confirmado = el }}
        type="button"
        className={`turno-status-btn confirmed ${confirmado ? 'active' : ''}`}
        onClick={() => change('confirmado')}
        aria-disabled={pending}
        aria-label="Marcar como confirmado"
        title="Confirmado"
      >
        <CheckCircle2 size={14} strokeWidth={2.7} />
        <span>Confirmado</span>
      </button>
      <button
        ref={(el) => { buttonRefs.current.atendido = el }}
        type="button"
        className={`turno-status-btn success ${atendido ? 'active' : ''}`}
        onClick={() => change('atendido')}
        aria-disabled={pending}
        aria-label="Marcar como atendido"
        title="Atendido"
      >
        <Check size={14} strokeWidth={2.8} />
        <span>Atendido</span>
      </button>
      <button
        ref={(el) => { buttonRefs.current.no_asistio = el }}
        type="button"
        className={`turno-status-btn danger ${ausente ? 'active' : ''}`}
        onClick={() => change('no_asistio')}
        aria-disabled={pending}
        aria-label="Marcar como faltó o cancelado"
        title="Faltó / cancelado"
      >
        <X size={14} strokeWidth={2.8} />
        <span>No asistió</span>
      </button>
      {error && <span className="ops-inline-error" role="alert">{error}</span>}
    </div>
  )
}
