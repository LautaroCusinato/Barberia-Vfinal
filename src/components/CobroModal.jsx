import { useEffect, useId, useRef, useState } from 'react'
import { X, Banknote, CreditCard, Landmark, Check } from 'lucide-react'
import { conPresencia } from '../lib/presencia'
import { FocusTrap } from './ui'

const METODOS = [
  { value: 'efectivo', label: 'Efectivo', Icon: Banknote },
  { value: 'mercadopago', label: 'Mercado Pago', Icon: CreditCard },
  { value: 'transferencia', label: 'Transferencia', Icon: Landmark },
]

function CobroModal({ turno, servicios = [], onClose, onConfirm }) {
  const formId = useId()
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState('efectivo')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const formRef = useRef(null)
  const montoRef = useRef(null)
  const enfocarMontoRef = useRef(false)

  // Se inicializa una vez por turno: una recarga de servicios (realtime)
  // no debe pisar el monto que la persona ya corrigió.
  const inicializadoParaRef = useRef(null)
  useEffect(() => {
    if (!turno) {
      inicializadoParaRef.current = null
      return
    }
    if (inicializadoParaRef.current === turno.id) return
    inicializadoParaRef.current = turno.id
    const servicioDelTurno = servicios.find((s) => String(s.id) === String(turno.servicio_id))
    setMonto(String(turno.precio ?? servicioDelTurno?.precio ?? ''))
    setMetodo('efectivo')
    setSaving(false)
    setErrorMsg('')
  }, [turno, servicios])

  // Tras un rechazo el importe vuelve a estar habilitado: se enfoca para
  // corregirlo o reintentar con Enter.
  useEffect(() => {
    if (saving || !enfocarMontoRef.current) return
    enfocarMontoRef.current = false
    montoRef.current?.focus()
  }, [saving])

  if (!turno) return null

  const valido = Number(monto) >= 0 && monto !== ''

  const submit = async (e) => {
    e.preventDefault()
    if (!valido || saving) return
    // Los controles se deshabilitan mientras guarda; sin esto el navegador
    // suelta el foco fuera del diálogo.
    formRef.current?.closest('[role="dialog"]')?.focus()
    setSaving(true)
    setErrorMsg('')
    try {
      await onConfirm({ monto: Number(monto), metodo })
    } catch (error) {
      // Sin esto el botón quedaba en "Guardando…" para siempre. Importe y
      // método quedan como estaban para reintentar.
      setErrorMsg(error?.name === 'CobroError' && error.message ? error.message : 'No se pudo registrar el cobro. Revisá tu conexión e intentá de nuevo.')
      enfocarMontoRef.current = true
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (!saving && e.target === e.currentTarget) onClose() }}>
      <FocusTrap onEscape={() => { if (!saving) onClose() }} className="modal-box" role="dialog" aria-modal="true" aria-labelledby={`${formId}-title`}>
        <div className="modal-header">
          <span className="panel-title-icon" id={`${formId}-title`}>
            <Banknote size={17} style={{ color: 'var(--accent)' }} />
            ¿Cómo se cobró este servicio?
          </span>
          <button className="btn-icon-plain" onClick={onClose} aria-label="Cerrar" disabled={saving}>
            <X size={17} />
          </button>
        </div>

        <p className="ops-help" style={{ marginTop: -6, marginBottom: 14 }}>
          {turno.paciente} — {turno.motivo || 'Turno'}
        </p>

        <form ref={formRef} onSubmit={submit} aria-busy={saving}>
          <div className="modal-field">
            <label className="modal-label" htmlFor={`${formId}-amount`}>Monto cobrado *</label>
            <input
              id={`${formId}-amount`}
              ref={montoRef}
              data-autofocus
              disabled={saving}
              className="text-input"
              type="number"
              min="0"
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
            />
          </div>

          <div className="modal-field">
            <label className="modal-label">Método de pago *</label>
            <div className="habilidades-tag-row">
              {METODOS.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  className={`habilidad-tag ${metodo === value ? 'active' : ''}`}
                  onClick={() => setMetodo(value)}
                  disabled={saving}
                  aria-pressed={metodo === value}
                >
                  <Icon size={13} />
                  {label}
                  {metodo === value && <Check size={12} className="habilidad-check" />}
                </button>
              ))}
            </div>
          </div>

          {errorMsg && <p className="field-error" role="alert">{errorMsg}</p>}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={!valido || saving}>
              {saving ? 'Guardando…' : 'Confirmar cobro'}
            </button>
          </div>
        </form>
      </FocusTrap>
    </div>
  )
}

// Animación de salida sin cambiar la lógica del modal.
export default conPresencia(CobroModal, 'turno')
