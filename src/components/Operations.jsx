import { Clock, Palette, Plus, Save, Scissors, Settings, Trash2, UserRound } from 'lucide-react'

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

const HORARIO_DEFAULT = { dias: new Set(['Lun', 'Mar', 'Mié', 'Jue', 'Vie']), desde: '09:00', hasta: '18:00' }

// El horario se guarda como texto plano en la base ("Lun, Mar y Jue 09:00-18:00")
// para no tener que tocar el schema, pero en la UI se edita todo con
// checkboxes de dia + selects de hora, nunca escribiendo a mano.
// OJO: este formato tiene que coincidir con el que sabe leer
// src/lib/text.js (parseHorarioBarbero), que es quien usa el horario
// de verdad al reservar un turno en NewTurnoModal.
function parseHorario(horario) {
  if (!horario) return HORARIO_DEFAULT
  const match = horario.match(/^(.+?)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/)
  if (!match) return HORARIO_DEFAULT
  const nombres = match[1].split(/\s*,\s*|\s+y\s+/).map((d) => d.trim()).filter(Boolean)
  const dias = new Set(nombres.filter((d) => DIAS.includes(d)))
  return { dias: dias.size ? dias : HORARIO_DEFAULT.dias, desde: match[2], hasta: match[3] }
}

function serializeHorario(dias, desde, hasta) {
  const ordenados = DIAS.filter((d) => dias.has(d))
  if (ordenados.length === 0) return `Sin dias asignados ${desde}-${hasta}`
  const diasTexto =
    ordenados.length === 1
      ? ordenados[0]
      : `${ordenados.slice(0, -1).join(', ')} y ${ordenados[ordenados.length - 1]}`
  return `${diasTexto} ${desde}-${hasta}`
}

export default function Operations({
  servicios,
  onAddServicio,
  onUpdateServicio,
  onDeleteServicio,
  barberos,
  onAddBarbero,
  onUpdateBarbero,
  onDeleteBarbero,
  config,
}) {
  const toggleDia = (barbero, dia) => {
    const parsed = parseHorario(barbero.horario)
    const nuevosDias = new Set(parsed.dias)
    if (nuevosDias.has(dia)) nuevosDias.delete(dia)
    else nuevosDias.add(dia)
    onUpdateBarbero(barbero.id, 'horario', serializeHorario(nuevosDias, parsed.desde, parsed.hasta))
  }

  const updateHora = (barbero, campo, valor) => {
    const parsed = parseHorario(barbero.horario)
    const desde = campo === 'desde' ? valor : parsed.desde
    const hasta = campo === 'hasta' ? valor : parsed.hasta
    onUpdateBarbero(barbero.id, 'horario', serializeHorario(parsed.dias, desde, hasta))
  }

  return (
    <div className="operations">
      <div className="panel ops-config-hero">
        <div>
          <p className="panel-title" style={{ marginBottom: 4 }}>
            <span className="panel-title-icon"><Settings size={16} />Configuracion de agenda</span>
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
            <span className="panel-title-icon"><Scissors size={16} />Servicios y precios</span>
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
                    Servicio
                    <input
                      className="text-input"
                      value={servicio.nombre}
                      onChange={(e) => onUpdateServicio(servicio.id, 'nombre', e.target.value)}
                    />
                  </label>
                  <div className="ops-edit-grid">
                    <label>
                      Precio
                      <input
                        className="text-input"
                        type="number"
                        min="0"
                        value={servicio.precio}
                        onChange={(e) => onUpdateServicio(servicio.id, 'precio', e.target.value)}
                      />
                    </label>
                    <label>
                      Duracion
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
                <button className="btn-icon-plain" onClick={() => onDeleteServicio(servicio.id)} aria-label="Eliminar servicio">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <p className="panel-title">
            <span className="panel-title-icon"><UserRound size={16} />Barberos disponibles</span>
            <button className="link-btn" onClick={onAddBarbero}>
              <Plus size={13} strokeWidth={2.5} />
              Agregar
            </button>
          </p>

          <div className="ops-edit-list">
            {barberos.map((barbero) => {
              const horario = parseHorario(barbero.horario)
              return (
                <div className="ops-edit-row ops-edit-row--barbero" key={barbero.id}>
                  <span className="ops-avatar" style={{ background: barbero.color }}>
                    {barbero.nombre.slice(0, 2).toUpperCase()}
                  </span>

                  <div className="ops-edit-main">
                    <div className="ops-edit-grid">
                      <label>
                        Nombre
                        <input
                          className="text-input"
                          value={barbero.nombre}
                          onChange={(e) => onUpdateBarbero(barbero.id, 'nombre', e.target.value)}
                        />
                      </label>
                      <label>
                        <span className="ops-color-label"><Palette size={11} />Color</span>
                        <input
                          className="color-input"
                          type="color"
                          value={barbero.color}
                          onChange={(e) => onUpdateBarbero(barbero.id, 'color', e.target.value)}
                        />
                      </label>
                    </div>

                    <label>
                      Dias que atiende
                      <div className="day-toggle-row">
                        {DIAS.map((dia) => (
                          <button
                            key={dia}
                            type="button"
                            className={`day-toggle ${horario.dias.has(dia) ? 'active' : ''}`}
                            style={horario.dias.has(dia) ? { background: barbero.color, borderColor: barbero.color } : undefined}
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
                  </div>

                  <button className="btn-icon-plain" onClick={() => onDeleteBarbero(barbero.id)} aria-label="Eliminar barbero">
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="panel">
        <p className="panel-title"><span className="panel-title-icon"><Clock size={16} />Como lo usaria el bot</span></p>
        <div className="readiness-list">
          <span className="done"><Save size={14} />El bot pregunta servicio, dia y horario.</span>
          <span className="done"><Save size={14} />El sistema revisa si algun barbero activo esta libre en ese bloque.</span>
          <span className="done"><Save size={14} />Si un barbero esta ocupado, otro puede tomar el mismo horario.</span>
          <span className="done"><Save size={14} />Los cambios de esta pantalla ya se guardan en Supabase (servicios y barberos).</span>
          <span><Save size={14} />Pendiente backend: horarios especiales por feriados o vacaciones puntuales.</span>
        </div>
        <p className="ops-help" style={{ marginTop: 12 }}>
          Link publico preparado para mas adelante: {config.linkReserva}
        </p>
      </div>
    </div>
  )
}
