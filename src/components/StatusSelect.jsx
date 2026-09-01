import { useState } from 'react'
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
    <div className="turno-status-actions" onClick={(e) => e.stopPropagation()} aria-busy={pending}>
      <button
        type="button"
        className={`turno-status-btn confirmed ${confirmado ? 'active' : ''}`}
        onClick={() => change('confirmado')}
        disabled={pending}
        aria-label="Marcar como confirmado"
        title="Confirmado"
      >
        <CheckCircle2 size={14} strokeWidth={2.7} />
        <span>Confirmado</span>
      </button>
      <button
        type="button"
        className={`turno-status-btn success ${atendido ? 'active' : ''}`}
        onClick={() => change('atendido')}
        disabled={pending}
        aria-label="Marcar como atendido"
        title="Atendido"
      >
        <Check size={14} strokeWidth={2.8} />
        <span>Atendido</span>
      </button>
      <button
        type="button"
        className={`turno-status-btn danger ${ausente ? 'active' : ''}`}
        onClick={() => change('no_asistio')}
        disabled={pending}
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
