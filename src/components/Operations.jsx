import { Clock, Palette, Plus, Save, Scissors, Settings, Trash2, UserRound, Coffee, Briefcase, Check } from 'lucide-react'

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
  breakDesde: '13:00',
  breakHasta: '14:00'
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
      breakDesde: HORARIO_DEFAULT.breakDesde,
      breakHasta: HORARIO_DEFAULT.breakHasta
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

function parseHabilidades(habilidadesStr) {
  if (!habilidadesStr) return []
  try {
    return JSON.parse(habilidadesStr)
  } catch {
    return []
  }
}

function serializeHabilidades(habilidades) {
  return JSON.stringify(habilidades)
}

function generarIdHabilidad(nombre) {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
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
  config,
}) {
  const habilidadesDisponibles = servicios
    .filter(s => s.activo !== false)
    .map(s => ({
      id: generarIdHabilidad(s.nombre),
      label: `${getEmoji(s.nombre)} ${s.nombre}`
    }))

  const toggleDia = (barbero, dia) => {
    const parsed = parseHorario(barbero.horario)
    const nuevosDias = new Set(parsed.dias)
    if (nuevosDias.has(dia)) nuevosDias.delete(dia)
    else nuevosDias.add(dia)
    onUpdateBarbero(
      barbero.id,
      'horario',
      serializeHorario(nuevosDias, parsed.desde, parsed.hasta, parsed.breakDesde, parsed.breakHasta)
    )
  }

  const updateHora = (barbero, campo, valor) => {
    const parsed = parseHorario(barbero.horario)
    const desde = campo === 'desde' ? valor : parsed.desde
    const hasta = campo === 'hasta' ? valor : parsed.hasta
    const breakDesde = campo === 'breakDesde' ? valor : parsed.breakDesde
    const breakHasta = campo === 'breakHasta' ? valor : parsed.breakHasta
    onUpdateBarbero(
      barbero.id,
      'horario',
      serializeHorario(parsed.dias, desde, hasta, breakDesde, breakHasta)
    )
  }

  const updateBreak = (barbero, campo, valor) => {
    const parsed = parseHorario(barbero.horario)
    const breakDesde = campo === 'breakDesde' ? valor : parsed.breakDesde
    const breakHasta = campo === 'breakHasta' ? valor : parsed.breakHasta
    onUpdateBarbero(
      barbero.id,
      'horario',
      serializeHorario(parsed.dias, parsed.desde, parsed.hasta, breakDesde, breakHasta)
    )
  }

  const toggleHabilidad = (barbero, habilidadId) => {
    const actuales = parseHabilidades(barbero.habilidades)
    const nuevas = actuales.includes(habilidadId)
      ? actuales.filter(h => h !== habilidadId)
      : [...actuales, habilidadId]
    onUpdateBarbero(barbero.id, 'habilidades', serializeHabilidades(nuevas))
  }

  return (
    <div className="operations">
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

      <div className="two-col">
        <div className="panel">
          <p className="panel-title">
            <span className="panel-title-icon">
              <Scissors size={16} />
              Servicios y precios
            </span>
            <button className="link-btn" onClick={onAddServicio}>
              <Plus size={13} strokeWidth={2.5} />
              Agregar
            </button>
          </p>

          <div className="ops-edit-list">
            {servicios.map((servicio) => (
              <div className="ops-edit-row" key={servicio.id}>
                <div className="ops-edit-main">
                  <label>
                    Nombre del servicio *
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        className="text-input"
                        value={servicio.nombre}
                        onChange={(e) => onUpdateServicio(servicio.id, 'nombre', e.target.value)}
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
                        onClick={() => onReactivarServicio(servicio.id)}
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
                      onChange={(e) => onUpdateServicio(servicio.id, 'descripcion', e.target.value)}
                    />
                  </label>

                  <div className="ops-edit-grid">
                    <label>
                      Precio ($) *
                      <input
                        className="text-input"
                        type="number"
                        min="0"
                        step="100"
                        value={servicio.precio}
                        onChange={(e) => onUpdateServicio(servicio.id, 'precio', e.target.value)}
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
                        onChange={(e) => onUpdateServicio(servicio.id, 'duracion', e.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <button
                  className="btn-icon-plain"
                  onClick={() => onDeleteServicio(servicio.id)}
                  aria-label="Eliminar servicio"
                  title="Eliminar servicio"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <p className="panel-title">
            <span className="panel-title-icon">
              <UserRound size={16} />
              Barberos disponibles
            </span>
            <button className="link-btn" onClick={onAddBarbero}>
              <Plus size={13} strokeWidth={2.5} />
              Agregar
            </button>
          </p>

          <div className="ops-edit-list">
            {barberos.map((barbero) => {
              const horario = parseHorario(barbero.horario)
              const habilidades = parseHabilidades(barbero.habilidades)

              return (
                <div className="ops-edit-row ops-edit-row--barbero" key={barbero.id}>
                  <span className="ops-avatar" style={{ background: barbero.color }}>
                    {barbero.nombre.slice(0, 2).toUpperCase()}
                  </span>

                  <div className="ops-edit-main">
                    <div className="ops-edit-grid">
                      <label>
                        Nombre *
                        <input
                          className="text-input"
                          value={barbero.nombre}
                          onChange={(e) => onUpdateBarbero(barbero.id, 'nombre', e.target.value)}
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
                          onChange={(e) => onUpdateBarbero(barbero.id, 'color', e.target.value)}
                        />
                      </label>
                    </div>

                    <label>
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
                              >
                                {hab.label}
                                {seleccionada && <Check size={12} className="habilidad-check" />}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </label>

                    <label>
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
                          >
                            {dia}
                          </button>
                        ))}
                      </div>
                    </label>

                    <div className="ops-edit-grid">
                      <label>
                        Desde
                        <select
                          className="text-input"
                          value={horario.desde}
                          onChange={(e) => updateHora(barbero, 'desde', e.target.value)}
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
                      <div className="ops-edit-grid">
                        <select
                          className="text-input"
                          value={horario.breakDesde}
                          onChange={(e) => updateBreak(barbero, 'breakDesde', e.target.value)}
                        >
                          {HORAS.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                        <select
                          className="text-input"
                          value={horario.breakHasta}
                          onChange={(e) => updateBreak(barbero, 'breakHasta', e.target.value)}
                        >
                          {HORAS.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    </label>
                  </div>

                  <button
                    className="btn-icon-plain"
                    onClick={() => onDeleteBarbero(barbero.id)}
                    aria-label="Eliminar barbero"
                    title="Eliminar barbero"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="panel">
        <p className="panel-title">
          <span className="panel-title-icon">
            <Clock size={16} />
            ¿Cómo lo usará el bot?
          </span>
        </p>

        <div className="readiness-list">
          <span className="done"><Save size={14} />El bot pregunta servicio, día y horario.</span>
          <span className="done"><Save size={14} />El sistema revisa si algún barbero activo está libre en ese bloque.</span>
          <span className="done"><Save size={14} />Si un barbero está ocupado, otro puede tomar el mismo horario.</span>
          <span className="done"><Save size={14} />Los cambios de esta pantalla ya se guardan en Supabase (servicios y barberos).</span>
          <span className="done"><Save size={14} />Los horarios con break bloquean automáticamente ese intervalo.</span>
          <span><Save size={14} />Pendiente backend: horarios especiales por feriados o vacaciones puntuales.</span>
        </div>

        <p className="ops-help" style={{ marginTop: 12 }}>
          <Briefcase size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Link público preparado para más adelante: {config.linkReserva}
        </p>
      </div>
    </div>
  )
}