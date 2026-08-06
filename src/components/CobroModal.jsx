import { useEffect, useState } from 'react'
import { X, Banknote, CreditCard, Landmark, Check } from 'lucide-react'

const METODOS = [
  { value: 'efectivo', label: 'Efectivo', Icon: Banknote },
  { value: 'mercadopago', label: 'Mercado Pago', Icon: CreditCard },
  { value: 'transferencia', label: 'Transferencia', Icon: Landmark },
]

export default function CobroModal({ turno, servicios = [], onClose, onConfirm }) {
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState('efectivo')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!turno) return
    const servicioDelTurno = servicios.find((s) => String(s.id) === String(turno.servicio_id))
    setMonto(String(turno.precio ?? servicioDelTurno?.precio ?? ''))
    setMetodo('efectivo')
    setSaving(false)
  }, [turno, servicios])

  if (!turno) return null

  const valido = Number(monto) >= 0 && monto !== ''

  const submit = async (e) => {
    e.preventDefault()
    if (!valido || saving) return
    setSaving(true)
    await onConfirm({ monto: Number(monto), metodo })
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box">
        <div className="modal-header">
          <span className="panel-title-icon">
            <Banknote size={17} style={{ color: 'var(--accent)' }} />
            ¿Cómo se cobró este servicio?
          </span>
          <button className="btn-icon-plain" onClick={onClose} aria-label="Cerrar">
            <X size={17} />
          </button>
        </div>

        <p className="ops-help" style={{ marginTop: -6, marginBottom: 14 }}>
          {turno.paciente} — {turno.motivo || 'Turno'}
        </p>

        <form onSubmit={submit}>
          <div className="modal-field">
            <label className="modal-label">Monto cobrado *</label>
            <input
              className="text-input"
              type="number"
              min="0"
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              autoFocus
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
                >
                  <Icon size={13} />
                  {label}
                  {metodo === value && <Check size={12} className="habilidad-check" />}
                </button>
              ))}
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={!valido || saving}>
              {saving ? 'Guardando...' : 'Confirmar cobro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
