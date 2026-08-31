import { useEffect, useState } from 'react'
import { X, UserPlus } from 'lucide-react'
import { PREFIJO_AR, soloDigitos } from '../lib/text'
import PhoneField from './PhoneField'

export default function NewPatientModal({ open, onClose, onSubmit }) {
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
  const digitosNumero = soloDigitos(telefono.slice(PREFIJO_AR.length))
  const telefonoRaw = soloDigitos(PREFIJO_AR) + digitosNumero
  const valido = nombre.trim() && digitosNumero.length === 8

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
      <div className="modal-box">
        <div className="modal-header">
          <span className="panel-title-icon">
            <UserPlus size={17} style={{ color: 'var(--accent)' }} />
            Agregar cliente
          </span>
          <button className="btn-icon-plain" onClick={onClose} disabled={saving} aria-label="Cerrar">
            <X size={17} />
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="modal-field">
            <label className="modal-label">Nombre y apellido *</label>
            <input
              className="text-input"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Juan Pérez"
              autoFocus
            />
          </div>

          <div className="modal-field">
            <label className="modal-label">Teléfono *</label>
            <PhoneField value={telefono} onChange={setTelefono} required aria-label="Teléfono" />
            {digitosNumero.length > 0 && digitosNumero.length !== 8 && (
              <small className="field-error">Completá los 8 dígitos del teléfono.</small>
            )}
          </div>

          <div className="modal-field">
            <label className="modal-label">Email (opcional)</label>
            <input
              className="text-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cliente@email.com"
            />
          </div>

          <div className="modal-field">
            <label className="modal-label">Última visita (opcional)</label>
            <input
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
              {saving ? 'Guardando...' : 'Agregar cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
