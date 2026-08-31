import { useRef, useState } from 'react'
import { Palette, Plus, Scissors, Settings, Trash2, UserRound, Coffee, Check } from 'lucide-react'
import { generarIdHabilidad, parseHabilidades, serializeHabilidades } from '../lib/text'
import { EmptyState } from './ui'

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const HORAS = (() => {
  const horas = []
  for (let h = 7; h <= 22; h++) {
    for (const m of [0, 30]) {
      horas.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return horas
})()

const HORARIO_DEFAULT = {
  dias: new Set(['Lun', 'Mar', 'Mié', 'Jue', 'Vie']),
  desde: '09:00',
  hasta: '18:00',
  breakDesde: '',
  breakHasta: ''
}

function parseHorario(horario) {
  if (!horario) return HORARIO_DEFAULT

  const matchBreak = horario.match(/^(.+?)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s+break\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/)
  if (matchBreak) {
    const [, diasStr, desde, hasta, breakDesde, breakHasta] = matchBreak
    const nombres = diasStr.split(/\s*,\s*|\s+y\s+/).map((d) => d.trim()).filter(Boolean)
    const dias = new Set(nombres.filter((d) => DIAS.includes(d)))
    return {
      dias: dias.size ? dias : HORARIO_DEFAULT.dias,
      desde,
      hasta,
      breakDesde,
      breakHasta
    }
  }

  const match = horario.match(/^(.+?)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/)
  if (match) {
    const [, diasStr, desde, hasta] = match
    const nombres = diasStr.split(/\s*,\s*|\s+y\s+/).map((d) => d.trim()).filter(Boolean)
    const dias = new Set(nombres.filter((d) => DIAS.includes(d)))
    return {
      dias: dias.size ? dias : HORARIO_DEFAULT.dias,
      desde,
      hasta,
      breakDesde: '',
      breakHasta: ''
    }
  }

  return HORARIO_DEFAULT
}

function serializeHorario(dias, desde, hasta, breakDesde, breakHasta) {
  const ordenados = DIAS.filter((d) => dias.has(d))
  if (ordenados.length === 0) return `Sin dias asignados ${desde}-${hasta}`

  const diasTexto =
    ordenados.length === 1
      ? ordenados[0]
      : `${ordenados.slice(0, -1).join(', ')} y ${ordenados[ordenados.length - 1]}`

  if (breakDesde && breakHasta && breakDesde !== breakHasta) {
    return `${diasTexto} ${desde}-${hasta} break ${breakDesde}-${breakHasta}`
  }

  return `${diasTexto} ${desde}-${hasta}`
}


function getEmoji(nombre) {
  const emojis = {
    'corte': '✂️',
    'barba': '🧔',
    'color': '🎨',
    'fade': '💇',
    'peinado': '✨',
    'combo': '🔥',
  }
  for (const [key, emoji] of Object.entries(emojis)) {
    if (nombre.toLowerCase().includes(key)) return emoji
  }
  return '📌'
}

export default function Operations({
  servicios,
  onAddServicio,
  onUpdateServicio,
  onDeleteServicio,
  onReactivarServicio,
  barberos,
  onAddBarbero,
  onUpdateBarbero,
  onDeleteBarbero,
  config: _config,
}) {
  // Los dos extremos de la pausa se editan en controles separados. Mientras
  // el usuario elige el segundo extremo conservamos el primero localmente,
  // sin persistir todavía un horario incompleto en Supabase.
  const [breakDrafts, setBreakDrafts] = useState({})
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [pending, setPending] = useState({})
  const [errors, setErrors] = useState({})
  const pendingTokens = useRef({})

  const runMutation = (key, action) => {
    const token = Symbol(key)
    pendingTokens.current[key] = token
    setPending((current) => ({ ...current, [key]: true }))
    setErrors((current) => ({ ...current, [key]: '' }))
    Promise.resolve().then(action).then((result) => {
      if (result === false) setErrors((current) => ({ ...current, [key]: 'No se pudo guardar. Intentá de nuevo.' }))
    }).catch(() => {
      setErrors((current) => ({ ...current, [key]: 'No se pudo guardar. Revisá tu conexión e intentá de nuevo.' }))
    }).finally(() => {
      if (pendingTokens.current[key] === token) setPending((current) => ({ ...current, [key]: false }))
    })
  }

  const mutateService = (id, field, value) => runMutation(`servicio:${id}:${field}`, () => onUpdateServicio(id, field, value))
  const mutateBarbero = (id, field, value) => runMutation(`barbero:${id}:${field}`, () => onUpdateBarbero(id, field, value))

  const horarioDe = (barbero) => {
    const base = parseHorario(barbero.horario)
    const draft = breakDrafts[barbero.id]
    return draft ? { ...base, ...draft } : base
  }

  const habilidadesDisponibles = servicios
    .filter(s => s.activo !== false)
    .map(s => ({
      id: generarIdHabilidad(s.nombre),
      label: `${getEmoji(s.nombre)} ${s.nombre}`
    }))

  const toggleDia = (barbero, dia) => {
    const parsed = horarioDe(barbero)
    const nuevosDias = new Set(parsed.dias)
    if (nuevosDias.has(dia)) nuevosDias.delete(dia)
    else nuevosDias.add(dia)
    setBreakDrafts((prev) => {
      const next = { ...prev }
      delete next[barbero.id]
      return next
    })
    mutateBarbero(
      barbero.id,
      'horario',
      serializeHorario(nuevosDias, parsed.desde, parsed.hasta, parsed.breakDesde, parsed.breakHasta)
    )
  }

  const updateHora = (barbero, campo, valor) => {
    const parsed = horarioDe(barbero)
    const desde = campo === 'desde' ? valor : parsed.desde
    const hasta = campo === 'hasta' ? valor : parsed.hasta
    const breakDesde = campo === 'breakDesde' ? valor : parsed.breakDesde
    const breakHasta = campo === 'breakHasta' ? valor : parsed.breakHasta
    setBreakDrafts((prev) => {
      const next = { ...prev }
      delete next[barbero.id]
      return next
    })
    mutateBarbero(
      barbero.id,
      'horario',
      serializeHorario(parsed.dias, desde, hasta, breakDesde, breakHasta)
    )
  }

  const updateBreak = (barbero, campo, valor) => {
    const parsed = horarioDe(barbero)

    // Elegir "Sin pausa" en cualquiera de los dos campos elimina la pausa
    // completa y evita dejar un horario parcial imposible de interpretar.
    if (!valor) {
      setBreakDrafts((prev) => {
        const next = { ...prev }
        delete next[barbero.id]
        return next
      })
      mutateBarbero(barbero.id, 'horario', serializeHorario(parsed.dias, parsed.desde, parsed.hasta, '', ''))
      return
    }

    const breakDesde = campo === 'breakDesde' ? valor : parsed.breakDesde
    const breakHasta = campo === 'breakHasta' ? valor : parsed.breakHasta
    const draft = { breakDesde, breakHasta }
    setBreakDrafts((prev) => ({ ...prev, [barbero.id]: draft }))

    // No escribimos hasta tener ambos extremos y una pausa válida dentro de
    // la jornada. El segundo cambio completa el borrador y recién ahí se
    // actualizan horario_texto y horarios_barbero.
    const pausaValida =
      breakDesde &&
      breakHasta &&
      breakDesde < breakHasta &&
      breakDesde > parsed.desde &&
      breakHasta < parsed.hasta

    if (pausaValida) {
      setBreakDrafts((prev) => {
        const next = { ...prev }
        delete next[barbero.id]
        return next
      })
      mutateBarbero(
        barbero.id,
        'horario',
        serializeHorario(parsed.dias, parsed.desde, parsed.hasta, breakDesde, breakHasta)
      )
    }
  }

  const toggleHabilidad = (barbero, habilidadId) => {
    const actuales = parseHabilidades(barbero.habilidades)
    const nuevas = actuales.includes(habilidadId)
      ? actuales.filter(h => h !== habilidadId)
      : [...actuales, habilidadId]
    mutateBarbero(barbero.id, 'habilidades', serializeHabilidades(nuevas))
  }

  return (
    <div className="management-screen management-operations operations">
      <div className="panel ops-config-hero">
        <div>
          <p className="panel-title" style={{ marginBottom: 4 }}>
            <span className="panel-title-icon">
              <Settings size={16} />
              Configuración de agenda
            </span>
          </p>
          <p className="ops-help">
            Los turnos se bloquean por barbero. Si hay 3 barberos activos, pueden existir hasta 3 turnos en el mismo horario, uno por cada barbero.
          </p>
        </div>
        <div className="ops-counts">
          <span><UserRound size={14} />{barberos.length} barberos</span>
          <span><Scissors size={14} />{servicios.length} servicios</span>
        </div>
      </div>
      {Object.values(errors).some(Boolean) && (
        <div className="error-banner" role="alert">{Object.values(errors).find(Boolean)}</div>
      )}

      <div className="two-col">
        <div className="panel management-section management-services">
          <p className="panel-title">
            <span className="panel-title-icon">
              <Scissors size={16} />
              Servicios y precios
            </span>
            <button className="link-btn management-add-action" onClick={() => runMutation('servicio:add', onAddServicio)} disabled={pending['servicio:add']} aria-busy={pending['servicio:add']}>
              <Plus size={13} strokeWidth={2.5} />
              Agregar
            </button>
          </p>

          <div className="ops-edit-list">
            {servicios.length === 0 ? (
              <EmptyState
                className="empty-state"
                icon={<Scissors size={26} aria-hidden="true" style={{ color: 'var(--border-strong)' }} />}
                title="Todavía no hay servicios configurados"
                action={<button type="button" className="btn btn-primary" onClick={() => runMutation('servicio:add', onAddServicio)} disabled={pending['servicio:add']}><Plus size={14} /> Agregar servicio</button>}
              />
            ) : servicios.map((servicio) => (
              <div className="ops-edit-row management-service-row" key={servicio.id}>
                <div className="ops-edit-main">
                  <label>
                    Nombre del servicio *
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        className="text-input"
                        value={servicio.nombre}
                        onChange={(e) => mutateService(servicio.id, 'nombre', e.target.value)}
                        aria-busy={pending[`servicio:${servicio.id}:nombre`]}
                        placeholder="Ej: Corte clásico"
                      />
                      {servicio.activo === false && (
                        <span className="badge" style={{ background: 'var(--border)', color: 'var(--ink-faint)', whiteSpace: 'nowrap' }}>
                          Inactivo
                        </span>
                      )}
                    </span>
                  </label>

                  {servicio.activo === false && (
                    <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: '-4px 0 4px' }}>
                      No aparece para agendar turnos nuevos porque tiene turnos asociados.{' '}
                      <button
                        type="button"
                        className="link-btn"
                        style={{ display: 'inline', fontSize: 11.5, padding: 0 }}
                        onClick={() => runMutation(`servicio:${servicio.id}:reactivar`, () => onReactivarServicio(servicio.id))}
                        disabled={pending[`servicio:${servicio.id}:reactivar`]}
                      >
                        Reactivar
                      </button>
                    </p>
                  )}

                  <label>
                    Descripción (opcional)
                    <input
                      className="text-input"
                      placeholder="Ej: Corte con tijera y máquina, degradado"
                      value={servicio.descripcion || ''}
                        onChange={(e) => mutateService(servicio.id, 'descripcion', e.target.value)}
                        aria-busy={pending[`servicio:${servicio.id}:descripcion`]}
                    />
                  </label>

                  <div className="ops-edit-grid management-service-meta">
                    <label>
                      Precio ($) *
                      <input
                        className="text-input"
                        type="number"
                        min="0"
                        step="100"
                        value={servicio.precio}
                        onChange={(e) => mutateService(servicio.id, 'precio', e.target.value)}
                        aria-busy={pending[`servicio:${servicio.id}:precio`]}
                      />
                    </label>
                    <label>
                      Duración (min) *
                      <input
                        className="text-input"
                        type="number"
                        min="5"
                        step="5"
                        value={servicio.duracion}
                        onChange={(e) => mutateService(servicio.id, 'duracion', e.target.value)}
                        aria-busy={pending[`servicio:${servicio.id}:duracion`]}
                      />
                    </label>
                  </div>
                </div>

                {confirmDelete?.type === 'servicio' && confirmDelete.id === servicio.id ? (
                  <div className="ops-delete-confirm" role="group" aria-label={`Confirmar eliminación de ${servicio.nombre}`}>
                    <span className="ops-inline-error">¿Eliminar este servicio?</span>
                    <button
                      type="button"
                      className="btn-icon-plain danger-solid"
                      onClick={() => runMutation(`servicio:${servicio.id}:delete`, async () => { const result = await onDeleteServicio(servicio.id); if (result !== false) setConfirmDelete(null); return result })}
                      disabled={pending[`servicio:${servicio.id}:delete`]}
                      aria-label="Confirmar eliminar servicio"
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon-plain"
                      onClick={() => setConfirmDelete(null)}
                      aria-label="Cancelar eliminar servicio"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-icon-plain"
                    onClick={() => setConfirmDelete({ type: 'servicio', id: servicio.id })}
                    aria-label="Eliminar servicio"
                    title="Eliminar servicio"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="panel management-section management-team-hours">
          <p className="panel-title">
            <span className="panel-title-icon">
              <UserRound size={16} />
              Barberos disponibles
            </span>
            <button className="link-btn management-add-action" onClick={() => runMutation('barbero:add', onAddBarbero)} disabled={pending['barbero:add']} aria-busy={pending['barbero:add']}>
              <Plus size={13} strokeWidth={2.5} />
              Agregar
            </button>
          </p>

          <div className="ops-edit-list">
          {barberos.map((barbero) => {
              const horario = horarioDe(barbero)
              const breakInvalido = horario.breakDesde && horario.breakHasta && (
                horario.breakDesde >= horario.breakHasta ||
                horario.breakDesde <= horario.desde ||
                horario.breakHasta >= horario.hasta
              )
              const habilidades = parseHabilidades(barbero.habilidades)

              return (
                <div className="ops-edit-row ops-edit-row--barbero management-employee-row" key={barbero.id}>
                  <span className="ops-avatar" style={{ background: barbero.color }}>
                    {barbero.nombre.slice(0, 2).toUpperCase()}
                  </span>

                  <div className="ops-edit-main">
                    <div className="ops-edit-grid management-employee-head">
                      <label>
                        Nombre *
                        <input
                          className="text-input"
                          value={barbero.nombre}
                          onChange={(e) => mutateBarbero(barbero.id, 'nombre', e.target.value)}
                          aria-busy={pending[`barbero:${barbero.id}:nombre`]}
                          placeholder="Ej: Tomás Vega"
                        />
                      </label>
                      <label>
                        <span className="ops-color-label">
                          <Palette size={11} />
                          Color
                        </span>
                        <input
                          className="color-input"
                          type="color"
                          value={barbero.color}
                          onChange={(e) => mutateBarbero(barbero.id, 'color', e.target.value)}
                          aria-busy={pending[`barbero:${barbero.id}:color`]}
                        />
                      </label>
                    </div>

                    <div className="ops-field-label management-specialties">
                      Habilidades (qué servicios puede hacer)
                      {habilidadesDisponibles.length === 0 ? (
                        <div className="ops-help" style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-faint)' }}>
                          Primero creá servicios en la sección de arriba
                        </div>
                      ) : (
                        <div className="habilidades-tag-row">
                          {habilidadesDisponibles.map((hab) => {
                            const seleccionada = habilidades.includes(hab.id)
                            return (
                              <button
                                key={hab.id}
                                type="button"
                                className={`habilidad-tag ${seleccionada ? 'active' : ''}`}
                                style={
                                  seleccionada
                                    ? { background: barbero.color, borderColor: barbero.color }
                                    : undefined
                                }
                                onClick={() => toggleHabilidad(barbero, hab.id)}
                                disabled={pending[`barbero:${barbero.id}:habilidades`]}
                              >
                                {hab.label}
                                {seleccionada && <Check size={12} className="habilidad-check" />}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    <div className="ops-field-label management-work-days">
                      Días que atiende
                      <div className="day-toggle-row">
                        {DIAS.map((dia) => (
                          <button
                            key={dia}
                            type="button"
                            className={`day-toggle ${horario.dias.has(dia) ? 'active' : ''}`}
                            style={
                              horario.dias.has(dia)
                                ? { background: barbero.color, borderColor: barbero.color }
                                : undefined
                            }
                            onClick={() => toggleDia(barbero, dia)}
                            disabled={pending[`barbero:${barbero.id}:horario`]}
                          >
                            {dia}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="ops-edit-grid management-hours-range">
                      <label>
                        Desde
                        <select
                          className="text-input"
                          value={horario.desde}
                          onChange={(e) => updateHora(barbero, 'desde', e.target.value)}
                          disabled={pending[`barbero:${barbero.id}:horario`]}
                        >
                          {HORAS.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Hasta
                        <select
                          className="text-input"
                          value={horario.hasta}
                          onChange={(e) => updateHora(barbero, 'hasta', e.target.value)}
                          disabled={pending[`barbero:${barbero.id}:horario`]}
                        >
                          {HORAS.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label>
                      <span className="ops-color-label">
                        <Coffee size={11} />
                        Pausa / Break (opcional)
                      </span>
                      <div className="ops-edit-grid management-break-range">
                        <select
                          className="text-input"
                          value={horario.breakDesde}
                          onChange={(e) => updateBreak(barbero, 'breakDesde', e.target.value)}
                          disabled={pending[`barbero:${barbero.id}:horario`]}
                        >
                          <option value="">Sin pausa</option>
                          {HORAS.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                        <select
                          className="text-input"
                          value={horario.breakHasta}
                          onChange={(e) => updateBreak(barbero, 'breakHasta', e.target.value)}
                          disabled={pending[`barbero:${barbero.id}:horario`]}
                        >
                          <option value="">Sin pausa</option>
                          {HORAS.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      {breakInvalido && (
                        <span className="ops-inline-error">La pausa debe quedar dentro de la jornada y terminar después de comenzar.</span>
                      )}
                    </label>
                  </div>

                  {confirmDelete?.type === 'barbero' && confirmDelete.id === barbero.id ? (
                    <div className="ops-delete-confirm" role="group" aria-label={`Confirmar eliminación de ${barbero.nombre}`}>
                      <span className="ops-inline-error">¿Eliminar este barbero?</span>
                      <button
                        type="button"
                        className="btn-icon-plain danger-solid"
                        onClick={() => runMutation(`barbero:${barbero.id}:delete`, async () => { const result = await onDeleteBarbero(barbero.id); if (result !== false) setConfirmDelete(null); return result })}
                        disabled={pending[`barbero:${barbero.id}:delete`]}
                        aria-label="Confirmar eliminar barbero"
                      >
                        <Trash2 size={15} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon-plain"
                        onClick={() => setConfirmDelete(null)}
                        aria-label="Cancelar eliminar barbero"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn-icon-plain"
                      onClick={() => setConfirmDelete({ type: 'barbero', id: barbero.id })}
                      aria-label="Eliminar barbero"
                      title="Eliminar barbero"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
