import { useEffect, useState } from 'react'
import { X, UserPen } from 'lucide-react'
import { PREFIJO_AR, soloDigitos, extraerNumeroLocal } from '../lib/text'
import PhoneField from './PhoneField'

export default function EditPatientModal({ paciente, onClose, onSubmit }) {
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState(PREFIJO_AR)
  const [ultimaVisita, setUltimaVisita] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!paciente) return
    setNombre(paciente.nombre || '')
    setTelefono(PREFIJO_AR + extraerNumeroLocal(paciente.telefono || ''))
    setUltimaVisita(paciente.ultima_visita || '')
    setSaving(false)
  }, [paciente])

  if (!paciente) return null

  const telefonoLocal = soloDigitos(telefono.slice(PREFIJO_AR.length))
  const valido = nombre.trim() && (telefonoLocal.length === 0 || telefonoLocal.length === 8)

  const submit = async (e) => {
    e.preventDefault()
    if (!valido || saving) return
    setSaving(true)
    // Guardamos el teléfono en solo dígitos (ej: 5491138922851), igual al
    // formato que usa el bot de WhatsApp para reconocer al cliente.
    const telefonoRaw = telefonoLocal.length ? soloDigitos(telefono) : null
    await onSubmit(paciente.id, {
      nombre: nombre.trim(),
      telefono: telefonoRaw || null,
      ultima_visita: ultimaVisita || null,
    })
    setSaving(false)
    onClose()
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box">
        <div className="modal-header">
          <span className="panel-title-icon">
            <UserPen size={17} style={{ color: 'var(--accent)' }} />
            Editar cliente
          </span>
          <button className="btn-icon-plain" onClick={onClose} aria-label="Cerrar">
            <X size={17} />
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="modal-field">
            <label className="modal-label">Nombre y apellido *</label>
            <input className="text-input" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
          </div>

          <div className="modal-field">
            <label className="modal-label">Teléfono</label>
            <PhoneField value={telefono} onChange={setTelefono} aria-label="Teléfono" />
            {telefonoLocal.length > 0 && telefonoLocal.length !== 8 && (
              <small className="field-error">Completá los 8 dígitos o dejá el teléfono vacío.</small>
            )}
          </div>

          <div className="modal-field">
            <label className="modal-label">Ultima visita</label>
            <input className="text-input" type="date" value={ultimaVisita || ''} onChange={(e) => setUltimaVisita(e.target.value)} />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={!valido || saving}>
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
