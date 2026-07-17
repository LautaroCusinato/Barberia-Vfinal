import { useEffect, useMemo, useRef, useState } from 'react'
import { X, CalendarPlus, AlertTriangle, Search, Plus, Clock, MapPin, CheckCircle2 } from 'lucide-react'
import { STATUS_OPTIONS, statusMeta } from './StatusSelect'
import {
  PREFIJO_AR,
  formatTelefonoAR,
  normalizar,
  parseHorarioBarbero,
  barberoDisponible,
  generarSlots,
} from '../lib/text'

const ESTADOS_MODAL = ['confirmado', 'atendido']
const DEFAULT_DURACION = 30

// Separa un nombre completo existente en nombre / apellido, asumiendo
// que la última palabra es el apellido y el resto el nombre.
function separarNombreApellido(nombreCompleto = '') {
  const partes = nombreCompleto.trim().split(/\s+/).filter(Boolean)
  if (partes.length <= 1) return { nombre: partes[0] || '', apellido: '' }
  return { nombre: partes.slice(0, -1).join(' '), apellido: partes[partes.length - 1] }
}

function toMinutes(hora = '00:00') {
  const [h, m] = hora.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function seSuperponen(aInicio, aDuracion, bInicio, bDuracion) {
  const aStart = toMinutes(aInicio)
  const bStart = toMinutes(bInicio)
  return aStart < bStart + bDuracion && bStart < aStart + aDuracion
}

// Saca una fecha (string YYYY-MM-DD) y devuelve el día de la semana en
// formato largo en español (lunes, martes, etc).
function diaSemanaLargo(fecha) {
  if (!fecha) return ''
  try {
    return new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long' })
  } catch {
    return ''
  }
}

export default function NewTurnoModal({
  open,
  onClose,
  onSubmit,
  defaultDate,
  turnoExistente,
  turnosExistentes = [],
  servicios = [],
  barberos = [],
  clientes = [],
}) {
  const esEdicion = Boolean(turnoExistente)

  const [fecha, setFecha] = useState(defaultDate)
  const [hora, setHora] = useState('')
  const [barberoId, setBarberoId] = useState('')
  const [servicioId, setServicioId] = useState('')
  const [estado, setEstado] = useState('confirmado')
  const [notas, setNotas] = useState('')

  // Cliente
  const [clienteQuery, setClienteQuery] = useState('')
  const [clienteElegido, setClienteElegido] = useState(null) // objeto {id,nombre,telefono} del picker
  const [crearNuevo, setCrearNuevo] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoApellido, setNuevoApellido] = useState('')
  const [nuevoTelefono, setNuevoTelefono] = useState('')

  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef(null)

  // Cuando se edita un turno, intentamos vincularlo a un cliente
  // existente por nombre para poder mostrarle el teléfono guardado y
  // no perder la info al actualizar.
  useEffect(() => {
    if (!open) return

    if (turnoExistente) {
      const { nombre: n, apellido: a } = separarNombreApellido(turnoExistente.paciente)
      setFecha(turnoExistente.fecha || defaultDate)
      setHora(turnoExistente.hora || '')
      setBarberoId(String(turnoExistente.barbero_id || barberos[0]?.id || ''))
      setServicioId(String(turnoExistente.servicio_id || servicios[0]?.id || ''))
      setEstado(ESTADOS_MODAL.includes(turnoExistente.estado) ? turnoExistente.estado : 'confirmado')
      setNotas(turnoExistente.motivo || '')

      const matchPorNombre = clientes.find((c) => normalizar(c.nombre) === normalizar(turnoExistente.paciente))
      if (matchPorNombre) {
        setClienteElegido(matchPorNombre)
        setCrearNuevo(false)
        setClienteQuery('')
      } else {
        setClienteElegido(null)
        setCrearNuevo(true)
        setNuevoNombre(n)
        setNuevoApellido(a)
        setNuevoTelefono('')
      }
    } else {
      setFecha(defaultDate)
      setHora('')
      setBarberoId(String(barberos[0]?.id || ''))
      setServicioId(String(servicios[0]?.id || ''))
      setEstado('confirmado')
      setNotas('')
      setClienteElegido(null)
      setCrearNuevo(false)
      setClienteQuery('')
      setNuevoNombre('')
      setNuevoApellido('')
      setNuevoTelefono('')
    }
    setSaving(false)
    setPickerOpen(false)
  }, [open, defaultDate, turnoExistente, servicios, barberos, clientes])

  const servicioSeleccionado = servicios.find((s) => String(s.id) === String(servicioId))
  const duracion = servicioSeleccionado?.duracion || turnoExistente?.duracion || DEFAULT_DURACION
  const precio = servicioSeleccionado?.precio || turnoExistente?.precio || 0
  const barberoSeleccionado = barberos.find((b) => String(b.id) === String(barberoId))

  // Slots del día en base al horario del barbero (si se puede parsear).
  // Si no se puede, usamos un rango amplio 09-20h.
  const slotsDelBarbero = useMemo(() => {
    const mapa = parseHorarioBarbero(barberoSeleccionado?.horario)
    if (!mapa) {
      return { slots: generarSlots(9 * 60, 20 * 60, 15), source: 'default' }
    }
    if (!fecha) return { slots: [], source: 'mapa' }
    const [y, m, d] = fecha.split('-').map(Number)
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
    const bloques = mapa[dow] || []
    const trabajo = bloques.filter((b) => !b.break)
    const breaks = bloques.filter((b) => b.break)
    const all = []
    for (const b of trabajo) {
      for (const slot of generarSlots(b.ini, b.fin, 15)) {
        const [hh, mm] = slot.split(':').map(Number)
        const minutos = hh * 60 + mm
        const enBreak = breaks.some((br) => minutos >= br.ini && minutos < br.fin)
        if (!enBreak) all.push(slot)
      }
    }
    return { slots: all, source: 'mapa' }
  }, [barberoSeleccionado, fecha])

  // Si cambia barbero o fecha, y la hora previamente elegida no entra
  // en la grilla nueva (ej: Mauro trabaja 10-19, Tomas 9-17, y el
  // usuario estaba en 09:00), limpiamos la hora para que el submit
  // no quede con un valor que no se ve en pantalla.
  useEffect(() => {
    if (!hora) return
    if (slotsDelBarbero.slots.length === 0) {
      setHora('')
      return
    }
    if (!slotsDelBarbero.slots.includes(hora)) setHora('')
  }, [barberoId, fecha, slotsDelBarbero.slots, hora])

  // Click fuera del picker
  useEffect(() => {
    function onClick(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setPickerOpen(false)
      }
    }
    if (pickerOpen) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [pickerOpen])

  // Turnos ya agendados ese día para ese barbero, para pintar la grilla
  const turnosDelBarberoEnFecha = useMemo(() => {
    if (!fecha || !barberoId) return []
    return (turnosExistentes || []).filter(
      (t) =>
        t.fecha === fecha &&
        String(t.barbero_id) === String(barberoId) &&
        t.id !== turnoExistente?.id &&
        statusMeta(t.estado).value !== 'no_asistio'
    )
  }, [turnosExistentes, fecha, barberoId, turnoExistente])

  // Sugerencias de clientes según lo que el usuario tipea
  const sugerencias = useMemo(() => {
    const q = normalizar(clienteQuery.trim())
    if (!q) return clientes.slice(0, 6)
    return clientes
      .filter((c) => normalizar(c.nombre).includes(q) || (c.telefono && c.telefono.includes(clienteQuery.trim())))
      .slice(0, 6)
  }, [clienteQuery, clientes])

  // Si el modal se cierra, no pintamos nada
  if (!open) return null

  function slotOcupado(slot) {
    return turnosDelBarberoEnFecha.some((t) => seSuperponen(slot, duracion, t.hora, t.duracion || DEFAULT_DURACION))
  }

  // El cliente final que se va a guardar como "paciente" del turno
  function resolverCliente() {
    if (clienteElegido) {
      return { nombre: clienteElegido.nombre, telefono: clienteElegido.telefono || '' }
    }
    if (crearNuevo) {
      const nombre = `${nuevoNombre.trim()} ${nuevoApellido.trim()}`.trim()
      const telefono = nuevoTelefono.trim()
      return { nombre, telefono }
    }
    return { nombre: '', telefono: '' }
  }

  const clienteFinal = resolverCliente()
  const nombreCompleto = clienteFinal.nombre

  // Validaciones
  const horaFueraHorario = barberoSeleccionado && fecha && hora && !barberoDisponible(barberoSeleccionado, fecha, hora)
  const superpuesto = (() => {
    if (!fecha || !hora || !barberoId) return null
    return turnosDelBarberoEnFecha.find((t) =>
      seSuperponen(hora, duracion, t.hora, t.duracion || DEFAULT_DURACION)
    )
  })()

  const valido =
    !!fecha &&
    !!hora &&
    !!barberoId &&
    !!servicioId &&
    !!nombreCompleto &&
    !superpuesto &&
    !horaFueraHorario

  // El nombre del cliente es válido si: lo elegiste del picker, o lo
  // estás tipeando como nuevo y tiene al menos nombre o apellido.
  const clienteValido = !!clienteElegido || (crearNuevo && (nuevoNombre.trim() || nuevoApellido.trim()))

  const onTelefonoChange = (e) => {
    setNuevoTelefono(formatTelefonoAR(e.target.value))
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!valido || saving) return
    setSaving(true)

    // Si el cliente es nuevo y tiene teléfono, lo creamos (en la versión
    // demo App.jsx se va a encargar). Si no, no creamos.
    const esClienteNuevo = !clienteElegido && crearNuevo && clienteValido

    await onSubmit({
      paciente: nombreCompleto,
      telefono: clienteFinal.telefono,
      fecha,
      hora,
      motivo: notas.trim() || servicioSeleccionado?.nombre || 'Corte',
      estado,
      servicio_id: Number(servicioId),
      barbero_id: Number(barberoId),
      precio,
      duracion,
      crearCliente: esClienteNuevo,
    }, turnoExistente?.id)
    setSaving(false)
    onClose()
  }

  // Render helpers
  const inputBase = 'text-input'
  const labelBase = 'modal-label'

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box new-turno-box new-turno-box-fixed">
        <div className="modal-scroll-body">
        <div className="modal-header">
          <span className="panel-title-icon">
            <CalendarPlus size={17} style={{ color: 'var(--accent)' }} />
            {esEdicion ? 'Editar turno' : 'Nuevo turno'}
          </span>
          <button className="btn-icon-plain" onClick={onClose} aria-label="Cerrar">
            <X size={17} />
          </button>
        </div>

        <form onSubmit={submit}>
          <section className="modal-section">
            <p className="modal-section-title">Fecha y profesional</p>
            <div className="modal-row">
              <div className="modal-field">
                <label className={labelBase}>Fecha *</label>
                <input
                  className={inputBase}
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </div>
              <div className="modal-field">
                <label className={labelBase}>Barbero *</label>
                <select className={inputBase} value={barberoId} onChange={(e) => setBarberoId(e.target.value)}>
                  {barberos.map((b) => (
                    <option key={b.id} value={b.id}>{b.nombre}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="modal-field">
              <label className={labelBase}>
                Horario disponible
                {barberoSeleccionado && (
                  <span className="barbero-schedule-hint">
                    {barberoSeleccionado.horario}
                  </span>
                )}
              </label>
              {slotsDelBarbero.slots.length === 0 ? (
                <p className="schedule-empty">
                  <MapPin size={13} /> {barberoSeleccionado?.nombre || 'Este barbero'} no trabaja los {diaSemanaLargo(fecha) || 'este día'}.
                </p>
              ) : (
                <div className="slot-grid">
                  {slotsDelBarbero.slots.map((slot) => {
                    const ocupado = slotOcupado(slot)
                    const seleccionado = hora === slot
                    const clase = [
                      'slot-chip',
                      ocupado && 'slot-busy',
                      seleccionado && 'slot-active',
                    ].filter(Boolean).join(' ')
                    return (
                      <button
                        type="button"
                        key={slot}
                        className={clase}
                        onClick={() => !ocupado && setHora(slot)}
                        disabled={ocupado}
                        title={ocupado ? 'Ocupado' : `Elegir ${slot}`}
                      >
                        {slot}
                      </button>
                    )
                  })}
                </div>
              )}
              {hora && (
                <p className="slot-summary">
                  <Clock size={12} />
                  <span>
                    {hora} – {(() => {
                      const finMin = toMinutes(hora) + duracion
                      const hh = String(Math.floor(finMin / 60)).padStart(2, '0')
                      const mm = String(finMin % 60).padStart(2, '0')
                      return `${hh}:${mm}`
                    })()} ({duracion} min)
                  </span>
                </p>
              )}
            </div>
          </section>

          <section className="modal-section">
            <p className="modal-section-title">Servicio</p>
            <div className="modal-field">
              <label className={labelBase}>Servicio *</label>
              <div className="service-grid">
                {servicios.filter((s) => s.activo !== false).map((s) => {
                  const seleccionado = String(s.id) === String(servicioId)
                  return (
                    <button
                      type="button"
                      key={s.id}
                      className={`service-chip ${seleccionado ? 'service-active' : ''}`}
                      onClick={() => setServicioId(String(s.id))}
                    >
                      <span className="service-chip-top">
                        <span className="service-name">{s.nombre}</span>
                        {seleccionado && <CheckCircle2 size={15} strokeWidth={2.6} />}
                      </span>
                      <span className="service-meta">
                        <span>{s.duracion} min</span>
                        <strong>${s.precio}</strong>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          <section className="modal-section">
            <p className="modal-section-title">Cliente</p>
            <div className="modal-field" ref={pickerRef}>
            <label className={labelBase}>Cliente *</label>

            {clienteElegido ? (
              <div className="client-chip">
                <span className="client-chip-avatar" style={{ background: 'var(--accent)' }}>
                  {clienteElegido.nombre.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()}
                </span>
                <div className="client-chip-info">
                  <p className="client-chip-name">{clienteElegido.nombre}</p>
                  <p className="client-chip-phone">{clienteElegido.telefono || 'Sin teléfono'}</p>
                </div>
                {!esEdicion && (
                  <button type="button" className="btn-icon-plain" onClick={() => setClienteElegido(null)} aria-label="Cambiar cliente">
                    <X size={14} />
                  </button>
                )}
              </div>
            ) : (
              <>
                {!crearNuevo && (
                  <div className="client-search">
                    <Search size={14} className="client-search-icon" />
                    <input
                      className={`${inputBase} client-search-input`}
                      placeholder="Buscar por nombre o teléfono..."
                      value={clienteQuery}
                      onChange={(e) => setClienteQuery(e.target.value)}
                      onFocus={() => setPickerOpen(true)}
                      autoComplete="off"
                    />
                  </div>
                )}

                {pickerOpen && !crearNuevo && (
                  <div className="client-dropdown">
                    {sugerencias.length === 0 ? (
                      <p className="client-dropdown-empty">Sin resultados para "{clienteQuery}"</p>
                    ) : (
                      sugerencias.map((c) => (
                        <button
                          type="button"
                          key={c.id}
                          className="client-dropdown-item"
                          onClick={() => {
                            setClienteElegido(c)
                            setPickerOpen(false)
                            setClienteQuery('')
                          }}
                        >
                          <span className="client-chip-avatar small" style={{ background: 'var(--accent)' }}>
                            {c.nombre.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()}
                          </span>
                          <span className="client-dropdown-info">
                            <span className="client-dropdown-name">{c.nombre}</span>
                            <span className="client-dropdown-phone">{c.telefono || 'Sin teléfono'}</span>
                          </span>
                        </button>
                      ))
                    )}
                    <button
                      type="button"
                      className="client-dropdown-create"
                      onClick={() => {
                        setCrearNuevo(true)
                        setPickerOpen(false)
                        setNuevoNombre(clienteQuery)
                      }}
                    >
                      <Plus size={13} strokeWidth={2.5} />
                      Crear nuevo cliente
                    </button>
                  </div>
                )}

                {crearNuevo && (
                  <div className="client-new">
                    <div className="modal-row" style={{ marginBottom: 0 }}>
                      <div className="modal-field" style={{ marginBottom: 8 }}>
                        <input
                          className={inputBase}
                          placeholder="Nombre"
                          value={nuevoNombre}
                          onChange={(e) => setNuevoNombre(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className="modal-field" style={{ marginBottom: 8 }}>
                        <input
                          className={inputBase}
                          placeholder="Apellido"
                          value={nuevoApellido}
                          onChange={(e) => setNuevoApellido(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="phone-field">
                      <span className="phone-prefix">{PREFIJO_AR}</span>
                      <input
                        className={`${inputBase} phone-input`}
                        type="tel"
                        inputMode="numeric"
                        placeholder="0000-0000"
                        value={nuevoTelefono.slice(PREFIJO_AR.length)}
                        onChange={onTelefonoChange}
                      />
                    </div>
                    {!esEdicion && (
                      <button
                        type="button"
                        className="link-btn"
                        style={{ marginTop: 6, fontSize: 11.5 }}
                        onClick={() => {
                          setCrearNuevo(false)
                          setNuevoNombre('')
                          setNuevoApellido('')
                          setNuevoTelefono('')
                        }}
                      >
                        Volver a buscar un cliente existente
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
            </div>
          </section>

          <section className="modal-section modal-section-compact">
            <div className="modal-row">
              <div className="modal-field">
                <label className={labelBase}>Estado</label>
                <select className={inputBase} value={estado} onChange={(e) => setEstado(e.target.value)}>
                  {ESTADOS_MODAL.map((v) => {
                    const opt = STATUS_OPTIONS.find((o) => o.value === v)
                    return <option key={v} value={v}>{opt?.label || v}</option>
                  })}
                </select>
              </div>
              <div className="modal-field">
                <label className={labelBase}>Notas</label>
                <input
                  className={inputBase}
                  placeholder="Opcional (ej: con tijera, sin lavar)"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* ====== Errores / avisos ====== */}
          {horaFueraHorario && !superpuesto && (
            <p className="login-error" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0 }} />
              {barberoSeleccionado?.nombre} no trabaja ese día a esa hora (su horario es {barberoSeleccionado.horario}).
            </p>
          )}
          {superpuesto && (
            <p className="login-error" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0 }} />
              {barberoSeleccionado?.nombre || 'Ese barbero'} ya tiene un turno de {superpuesto.paciente} a las {superpuesto.hora} que se superpone con este horario.
            </p>
          )}

          {/* ====== Acciones ====== */}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!valido || !clienteValido || saving}
            >
              {saving ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Agendar turno'}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}
