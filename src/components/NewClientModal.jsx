import { useEffect, useId, useState } from 'react'
import { X, UserPlus } from 'lucide-react'
import { PREFIJO_AR, TELEFONO_NACIONAL_DIGITOS, digitosNacionales, soloDigitos } from '../lib/text'
import PhoneField from './PhoneField'
import { conPresencia } from '../lib/presencia'
import { FocusTrap } from './ui'

function NewClientModal({ open, onClose, onSubmit }) {
  const formId = useId()
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState(PREFIJO_AR)
  const [email, setEmail] = useState('')
  const [ultimaVisita, setUltimaVisita] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (open) {
      setNombre('')
      setTelefono(PREFIJO_AR)
      setEmail('')
      setUltimaVisita('')
      setSaving(false)
      setErrorMsg('')
    }
  }, [open])

  if (!open) return null

  // Guardamos el teléfono como solo dígitos (ej: 5491138922851), igual al
  // formato que usa el bot de WhatsApp — así el mismo cliente que después
  // escribe por WhatsApp calza con este teléfono en vez de crear un duplicado.
  const digitosNumero = digitosNacionales(telefono)
  const telefonoRaw = soloDigitos(PREFIJO_AR) + digitosNumero
  const valido = nombre.trim() && digitosNumero.length === TELEFONO_NACIONAL_DIGITOS

  const submit = async (e) => {
    e.preventDefault()
    if (!valido || saving) return
    setSaving(true)
    setErrorMsg('')

    try {
      const ok = await onSubmit({
        nombre: nombre.trim(),
        telefono: telefonoRaw,
        email: email.trim() || null,
        ultima_visita: ultimaVisita || null,
      })
      if (ok !== false) onClose()
      else setErrorMsg('No se pudo guardar. Revisá que el teléfono no esté repetido.')
    } catch {
      setErrorMsg('No se pudo guardar. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (!saving && e.target === e.currentTarget) onClose() }}>
      <FocusTrap onEscape={() => { if (!saving) onClose() }} className="modal-box" role="dialog" aria-modal="true" aria-labelledby={`${formId}-title`}>
        <div className="modal-header">
          <span className="panel-title-icon" id={`${formId}-title`}>
            <UserPlus size={17} style={{ color: 'var(--accent)' }} />
            Agregar cliente
          </span>
          <button className="btn-icon-plain" onClick={onClose} disabled={saving} aria-label="Cerrar">
            <X size={17} />
          </button>
        </div>

        <form onSubmit={submit} aria-busy={saving}>
          <div className="modal-field">
            <label className="modal-label" htmlFor={`${formId}-name`}>Nombre y apellido *</label>
            <input
              id={`${formId}-name`}
              data-autofocus
              disabled={saving}
              className="text-input"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Juan Pérez"
            />
          </div>

          <div className="modal-field">
            <label className="modal-label" htmlFor={`${formId}-phone`}>Teléfono *</label>
            <PhoneField id={`${formId}-phone`} value={telefono} onChange={setTelefono} disabled={saving} required aria-label="Teléfono" />
            {digitosNumero.length > 0 && digitosNumero.length !== TELEFONO_NACIONAL_DIGITOS && (
              <small className="field-error">Completá código de área y número: 10 dígitos, sin 0 ni 15.</small>
            )}
          </div>

          <div className="modal-field">
            <label className="modal-label" htmlFor={`${formId}-email`}>Email (opcional)</label>
            <input
              id={`${formId}-email`}
              disabled={saving}
              className="text-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cliente@email.com"
            />
          </div>

          <div className="modal-field">
            <label className="modal-label" htmlFor={`${formId}-visit`}>Última visita (opcional)</label>
            <input
              id={`${formId}-visit`}
              disabled={saving}
              className="text-input"
              type="date"
              value={ultimaVisita}
              onChange={(e) => setUltimaVisita(e.target.value)}
            />
          </div>

          {errorMsg && (
            <p role="alert" style={{ color: 'var(--danger, #e5484d)', fontSize: 12.5, marginTop: -4, marginBottom: 10 }}>
              {errorMsg}
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={!valido || saving}>
              {saving ? 'Guardando…' : 'Agregar cliente'}
            </button>
          </div>
        </form>
      </FocusTrap>
    </div>
  )
}

// Animación de salida sin cambiar la lógica del modal.
export default conPresencia(NewClientModal, 'open')
