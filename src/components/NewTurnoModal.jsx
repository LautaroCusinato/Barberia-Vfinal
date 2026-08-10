import { useEffect, useMemo, useRef, useState } from 'react'
import { X, CalendarPlus, AlertTriangle, Search, Plus, Clock, MapPin, CheckCircle2 } from 'lucide-react'
import { STATUS_OPTIONS, statusMeta } from './StatusSelect'
import PhoneField from './PhoneField'
import { FocusTrap } from './ui'
import {
  PREFIJO_AR,
  soloDigitos,
  normalizar,
  parseHorarioBarbero,
  barberoDisponible,
  barberoHaceServicio,
  barberoBloqueadoFecha,
  generarSlots,
} from '../lib/text'

const ESTADOS_MODAL = ['confirmado', 'atendido']
const DEFAULT_DURACION = 30

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
  bloqueos = [],
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
  const [nuevoTelefono, setNuevoTelefono] = useState('')

  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef(null)

  // Cuando se edita un turno, lo vinculamos al cliente por su cliente_id
  // (el turno lo guarda desde que se crea) — nunca por el nombre, porque
  // el nombre puede cambiar o no coincidir exacto y el cliente ya existe.
  useEffect(() => {
    if (!open) return

    if (turnoExistente) {
      setFecha(turnoExistente.fecha || defaultDate)
      setHora(turnoExistente.hora || '')
      setBarberoId(String(turnoExistente.barbero_id || barberos[0]?.id || ''))
      setServicioId(String(turnoExistente.servicio_id || servicios[0]?.id || ''))
      setEstado(ESTADOS_MODAL.includes(turnoExistente.estado) ? turnoExistente.estado : 'confirmado')
      setNotas(turnoExistente.motivo || '')

      const matchPorId = turnoExistente.cliente_id != null
        ? clientes.find((c) => c.id === turnoExistente.cliente_id)
        : null
      // Fallback solo para turnos viejos que se hayan guardado sin
      // cliente_id (de antes de este fix): probamos por nombre.
      const matchPorNombre = matchPorId ? null : clientes.find((c) => normalizar(c.nombre) === normalizar(turnoExistente.paciente))
      const match = matchPorId || matchPorNombre

      if (match) {
        setClienteElegido(match)
        setCrearNuevo(false)
        setClienteQuery('')
      } else {
        setClienteElegido(null)
        setCrearNuevo(true)
        setNuevoNombre(turnoExistente.paciente || '')
        setNuevoTelefono(PREFIJO_AR)
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
      setNuevoTelefono(PREFIJO_AR)
    }
    setSaving(false)
    setPickerOpen(false)
  }, [open, defaultDate, turnoExistente, servicios, barberos, clientes])

  const servicioSeleccionado = servicios.find((s) => String(s.id) === String(servicioId))
  const duracion = servicioSeleccionado?.duracion || turnoExistente?.duracion || DEFAULT_DURACION
  const precio = servicioSeleccionado?.precio || turnoExistente?.precio || 0
  // Solo dejamos elegir barberos que sepan hacer el servicio seleccionado
  // (los que no tienen ninguna habilidad cargada cuentan como "hacen todo")
  // Y que no tengan un día libre/bloqueo cargado para la fecha elegida.
  const barberosDisponibles = barberos.filter(
    (b) => barberoHaceServicio(b, servicioSeleccionado) && !barberoBloqueadoFecha(bloqueos, b.id, fecha)
  )
  const barberoSeleccionado = barberos.find((b) => String(b.id) === String(barberoId))
  // Si cambiás el servicio o la fecha y el barbero que tenías elegido ya no
  // puede (no sabe hacerlo, o tiene un día libre ese día), pasamos
  // automáticamente al primero que sí puede.
  useEffect(() => {
    if (!open) return
    const sigueSiendoValido = barberosDisponibles.some((b) => String(b.id) === String(barberoId))
    if (!sigueSiendoValido) {
      setBarberoId(String(barberosDisponibles[0]?.id || ''))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicioId, fecha])

  // Slots del día en base al horario del barbero (si se puede parsear).
  // Si no se puede, usamos un rango amplio 09-20h.
  // OJO: un slot solo es válido si el turno ENTERO (desde que arranca
  // hasta que termina, según la duración del servicio elegido) entra
  // antes del cierre y no pisa el horario de break — no alcanza con que
  // el horario de inicio caiga adentro.
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
        const inicio = hh * 60 + mm
        const fin = inicio + (Number(duracion) || 0)
        if (fin > b.fin) continue // no entra completo antes del cierre de este bloque
        const pisaBreak = breaks.some((br) => inicio < br.fin && fin > br.ini)
        if (!pisaBreak) all.push(slot)
      }
    }
    return { slots: all, source: 'mapa' }
  }, [barberoSeleccionado, fecha, duracion])

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
      return { nombre: clienteElegido.nombre, telefono: clienteElegido.telefono || '', clienteId: clienteElegido.id }
    }
    if (crearNuevo) {
      const nombre = nuevoNombre.trim()
      // Guardamos el telefono en solo digitos (ej: 5491138922851), el
      // mismo formato que usa el bot de WhatsApp — asi si este cliente
      // despues escribe por WhatsApp, el numero matchea y no se duplica.
      const telefono = soloDigitos(nuevoTelefono)
      return { nombre, telefono, clienteId: null }
    }
    return { nombre: '', telefono: '', clienteId: null }
  }

  const clienteFinal = resolverCliente()
  const nombreCompleto = clienteFinal.nombre
  const telefonoLocal = soloDigitos(nuevoTelefono.slice(PREFIJO_AR.length))

  // Validaciones
  const horaFueraHorario = barberoSeleccionado && fecha && hora && !barberoDisponible(barberoSeleccionado, fecha, hora, duracion)
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
  // estás tipeando como nuevo y tiene nombre.
  const clienteValido = !!clienteElegido || (crearNuevo && nuevoNombre.trim() && telefonoLocal.length === 8)

  const submit = async (e) => {
    e.preventDefault()
    if (!valido || saving) return
    setSaving(true)

    await onSubmit({
      paciente: nombreCompleto,
      telefono: clienteFinal.telefono,
      clienteId: clienteFinal.clienteId,
      fecha,
      hora,
      motivo: notas.trim() || servicioSeleccionado?.nombre || 'Corte',
      estado,
      servicio_id: Number(servicioId),
      barbero_id: Number(barberoId),
      precio,
      duracion,
    }, turnoExistente?.id)
    setSaving(false)
    onClose()
  }

  // Render helpers
  const inputBase = 'text-input'
  const labelBase = 'modal-label'

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <FocusTrap open onEscape={onClose} className="modal-box new-turno-box new-turno-box-fixed" role="dialog" aria-modal="true" aria-labelledby="new-turno-title">
        <div className="modal-header">
          <span className="panel-title-icon" id="new-turno-title">
            <CalendarPlus size={17} style={{ color: 'var(--accent)' }} />
            {esEdicion ? 'Editar turno' : 'Nuevo turno'}
          </span>
          <button className="btn-icon-plain" onClick={onClose} aria-label="Cerrar">
            <X size={17} />
          </button>
        </div>

        <form onSubmit={submit} className="new-turno-form">
          <div className="modal-scroll-body">
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
                  {barberosDisponibles.map((b) => (
                    <option key={b.id} value={b.id}>{b.nombre}</option>
                  ))}
                </select>
                {barberosDisponibles.length === 0 && (
                  <p className="schedule-empty" style={{ marginTop: 6 }}>
                    Ningún barbero tiene cargado ese servicio en "Habilidades" (Operación → Equipo).
                  </p>
                )}
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
                    <div className="modal-field" style={{ marginBottom: 8 }}>
                      <input
                        className={inputBase}
                        placeholder="Nombre y apellido"
                        value={nuevoNombre}
                        onChange={(e) => setNuevoNombre(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <PhoneField
                      className="modal-phone-field"
                      value={nuevoTelefono}
                      onChange={setNuevoTelefono}
                      aria-label="Teléfono"
                    />
                    {!esEdicion && (
                      <button
                        type="button"
                        className="link-btn"
                        style={{ marginTop: 6, fontSize: 11.5 }}
                        onClick={() => {
                          setCrearNuevo(false)
                          setNuevoNombre('')
                          setNuevoTelefono(PREFIJO_AR)
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
          </div>

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
      </FocusTrap>
    </div>
  )
}
