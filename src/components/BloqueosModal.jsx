import { useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertTriangle, Ban, CalendarX, LockOpen } from 'lucide-react'
import { Badge, Button, Checkbox, FormField, Input, LiveRegion, Modal, Select } from './ui'
import {
  TIPOS_BLOQUEO,
  bloqueosVigentes,
  esBloqueoDiaCompleto,
  planificarBloqueo,
  rangoBloqueo,
  turnosAfectados,
} from '../lib/bloqueosAgenda.js'
import { capitalizar } from '../lib/text'
import './bloqueos.css'

const fechaLarga = (fecha) => capitalizar(format(parseISO(fecha), "EEEE d 'de' MMMM", { locale: es }))
// Dentro de una oración: "el martes 6 de octubre".
const fechaEnTexto = (fecha) => format(parseISO(fecha), "EEEE d 'de' MMMM", { locale: es })
const fechaCorta = (fecha) => capitalizar(format(parseISO(fecha), "EEE d MMM", { locale: es }))

// Gestión de fechas bloqueadas desde la Agenda (tarea 41). El servidor decide
// permisos y disponibilidad; acá sólo se anuncia éxito después de guardar.
export default function BloqueosModal({ open, onClose, fechaInicial, todayKey, barberos = [], bloqueos = [], turnos = [], onRevisarTurnos, onBloquear, onDesbloquear }) {
  const [desde, setDesde] = useState('')
  const [variasFechas, setVariasFechas] = useState(false)
  const [hasta, setHasta] = useState('')
  const [alcance, setAlcance] = useState('')
  const [tipo, setTipo] = useState('cierre')
  const [detalle, setDetalle] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [revisando, setRevisando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [confirmacion, setConfirmacion] = useState(null)
  const [desbloqueando, setDesbloqueando] = useState(() => new Set())
  const [errorLista, setErrorLista] = useState('')
  const guardandoRef = useRef(false)
  const desbloqueandoRef = useRef(new Set())
  const desdeRef = useRef(null)
  const listaTituloRef = useRef(null)
  const confirmarRef = useRef(null)

  // Al abrir se parte de la fecha elegida en el calendario (o de hoy si es pasada).
  useEffect(() => {
    if (!open) return
    const inicial = fechaInicial && fechaInicial >= todayKey ? fechaInicial : todayKey
    setDesde(inicial)
    setHasta(inicial)
    setVariasFechas(false)
    setError('')
    setAviso('')
    setErrorLista('')
    setConfirmacion(null)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cualquier cambio del formulario invalida una confirmación pendiente.
  useEffect(() => { setConfirmacion(null) }, [desde, hasta, variasFechas, alcance])

  useEffect(() => {
    if (confirmacion) confirmarRef.current?.focus()
  }, [confirmacion])

  const barberosActivos = useMemo(() => barberos.filter((b) => b.activo !== false), [barberos])
  const nombreBarbero = (id) => barberos.find((b) => String(b.id) === String(id))?.nombre || 'Profesional'
  const vigentes = useMemo(() => bloqueosVigentes(bloqueos, todayKey), [bloqueos, todayKey])
  const porFecha = useMemo(() => {
    const grupos = new Map()
    for (const b of vigentes) {
      if (!grupos.has(b.fecha)) grupos.set(b.fecha, [])
      grupos.get(b.fecha).push(b)
    }
    return [...grupos.entries()]
  }, [vigentes])

  if (!open) return null

  const cerrar = () => { if (!guardandoRef.current) onClose() }
  const barberoId = alcance === '' ? null : alcance
  const alcanceTexto = barberoId == null ? 'todo el negocio' : nombreBarbero(barberoId)

  const enviar = async (confirmado) => {
    if (guardandoRef.current) return
    setError('')
    setAviso('')
    const plan = planificarBloqueo({ desde, hasta: variasFechas ? hasta : desde, barberoId, bloqueos, todayKey })
    if (plan.error) { setError(plan.error); desdeRef.current?.focus(); return }
    if (!plan.nuevas.length) {
      setError(plan.yaBloqueadas.length > 1 ? `Esas fechas ya están bloqueadas para ${alcanceTexto}.` : `Esa fecha ya está bloqueada para ${alcanceTexto}.`)
      return
    }
    guardandoRef.current = true
    setGuardando(true)
    try {
      if (!confirmado) {
        // Se consulta la base: la lista del panel puede no tener todos los
        // turnos futuros. Sin esa revisión no se bloquea nada.
        setRevisando(true)
        const revision = onRevisarTurnos
          ? await onRevisarTurnos({ fechas: plan.nuevas, barberoId })
          : { ok: true, turnos: turnosAfectados(turnos, plan.nuevas, barberoId) }
        setRevisando(false)
        if (!revision?.ok) {
          setError('No pudimos revisar los turnos de esas fechas, así que no se bloqueó nada. Revisá la conexión e intentá de nuevo.')
          return
        }
        if (revision.turnos.length) {
          setConfirmacion({ afectados: revision.turnos, fechas: plan.nuevas })
          return
        }
      }
      const resultado = await onBloquear({ fechas: plan.nuevas, barberoId, tipo, detalle })
      if (resultado?.ok) {
        const cuantas = plan.nuevas.length
        const omitidas = plan.yaBloqueadas.length ? ` ${plan.yaBloqueadas.length === 1 ? 'Una fecha ya estaba bloqueada' : `${plan.yaBloqueadas.length} fechas ya estaban bloqueadas`} y no se duplicó.` : ''
        setAviso(`${cuantas === 1 ? `Bloqueado el ${fechaEnTexto(plan.nuevas[0])}` : `Bloqueadas ${cuantas} fechas`} para ${alcanceTexto}. Ya no se ofrecen para nuevas reservas.${omitidas}`)
        setConfirmacion(null)
        setDetalle('')
      } else {
        setError(resultado?.mensaje || 'No se pudo guardar el bloqueo. Intentá de nuevo.')
      }
    } catch {
      setError('No se pudo guardar el bloqueo. Revisá la conexión e intentá de nuevo.')
    } finally {
      guardandoRef.current = false
      setGuardando(false)
      setRevisando(false)
    }
  }

  const desbloquear = async (bloqueo) => {
    const key = String(bloqueo.id)
    if (desbloqueandoRef.current.has(key)) return
    desbloqueandoRef.current.add(key)
    setDesbloqueando(new Set(desbloqueandoRef.current))
    setErrorLista('')
    setAviso('')
    try {
      const resultado = await onDesbloquear(bloqueo)
      if (resultado?.ok) {
        setAviso(`Desbloqueado el ${fechaEnTexto(bloqueo.fecha)} para ${bloqueo.barbero_id == null ? 'todo el negocio' : nombreBarbero(bloqueo.barbero_id)}.`)
        listaTituloRef.current?.focus()
      } else {
        setErrorLista(resultado?.mensaje || 'No se pudo desbloquear. Intentá de nuevo.')
      }
    } catch {
      setErrorLista('No se pudo desbloquear. Revisá la conexión e intentá de nuevo.')
    } finally {
      desbloqueandoRef.current.delete(key)
      setDesbloqueando(new Set(desbloqueandoRef.current))
    }
  }

  return (
    <Modal open={open} onClose={cerrar} title="Bloquear fechas" className="bloqueos-modal">
      <form
        className="bloqueos-form"
        noValidate
        onSubmit={(event) => { event.preventDefault(); enviar(false) }}
      >
        <p className="bloqueos-intro">
          Las fechas bloqueadas dejan de ofrecerse en el panel, la reserva web y WhatsApp. Los turnos ya agendados se conservan.
        </p>

        <div className="bloqueos-grid">
          <FormField label={variasFechas ? 'Desde' : 'Fecha'} required>
            <Input ref={desdeRef} data-autofocus type="date" min={todayKey} value={desde} onChange={(e) => { setDesde(e.target.value); if (!variasFechas || hasta < e.target.value) setHasta(e.target.value) }} />
          </FormField>
          {variasFechas && (
            <FormField label="Hasta" hint="Se bloquea cada día del rango, hasta 62.">
              <Input type="date" min={desde || todayKey} value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </FormField>
          )}
        </div>
        <Checkbox label="Varias fechas seguidas" checked={variasFechas} onChange={(e) => setVariasFechas(e.target.checked)} />

        <div className="bloqueos-grid">
          <FormField label="Para quién">
            <Select value={alcance} onChange={(e) => setAlcance(e.target.value)}>
              <option value="">Todo el negocio</option>
              {barberosActivos.map((b) => <option key={b.id} value={String(b.id)}>{b.nombre}</option>)}
            </Select>
          </FormField>
          <FormField label="Motivo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS_BLOQUEO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </FormField>
        </div>
        <FormField label="Detalle (opcional)" hint="Se ve sólo en el panel.">
          <Input maxLength={120} value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Ej.: Día del Trabajador" />
        </FormField>

        {confirmacion && (
          <div className="bloqueos-confirm" role="alert">
            <p className="bloqueos-confirm-title"><AlertTriangle size={16} aria-hidden="true" /> {confirmacion.afectados.length === 1 ? 'Hay 1 turno agendado' : `Hay ${confirmacion.afectados.length} turnos agendados`} en {confirmacion.fechas.length === 1 ? 'esa fecha' : 'esas fechas'}</p>
            <ul className="bloqueos-confirm-list">
              {confirmacion.afectados.slice(0, 8).map((t) => (
                <li key={t.id}><strong>{fechaCorta(t.fecha)} · {String(t.hora || '').slice(0, 5)}</strong> {t.paciente || 'Cliente'}{barberoId == null && t.barbero_id != null ? ` · ${nombreBarbero(t.barbero_id)}` : ''}</li>
              ))}
              {confirmacion.afectados.length > 8 && <li>y {confirmacion.afectados.length - 8} más</li>}
            </ul>
            <p className="bloqueos-confirm-note">No se cancelan ni se avisa a los clientes: sólo se dejan de aceptar reservas nuevas. Si hace falta, reprogramalos desde la Agenda.</p>
            <div className="bloqueos-actions">
              <Button variant="ghost" onClick={() => setConfirmacion(null)}>Revisar</Button>
              <Button ref={confirmarRef} variant="danger" className="bloqueos-submit" aria-disabled={guardando || undefined} onClick={() => enviar(true)}>
                <Ban size={15} aria-hidden="true" />{guardando ? 'Bloqueando…' : 'Bloquear igual'}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="bloqueos-error" role="alert">{error}</p>}
        <LiveRegion className="bloqueos-aviso">{aviso}</LiveRegion>

        {!confirmacion && (
          <div className="bloqueos-actions">
            <Button variant="ghost" onClick={cerrar} aria-disabled={guardando || undefined}>Cerrar</Button>
            <Button type="submit" variant="danger" className="bloqueos-submit" aria-disabled={guardando || undefined}>
              <Ban size={15} aria-hidden="true" />{revisando ? 'Revisando turnos…' : guardando ? 'Bloqueando…' : 'Bloquear'}
            </Button>
          </div>
        )}
      </form>

      <section className="bloqueos-lista" aria-labelledby="bloqueos-lista-titulo">
        <h3 id="bloqueos-lista-titulo" ref={listaTituloRef} tabIndex={-1} className="bloqueos-lista-titulo">Fechas bloqueadas</h3>
        {errorLista && <p className="bloqueos-error" role="alert">{errorLista}</p>}
        {porFecha.length === 0 ? (
          <p className="bloqueos-vacio"><CalendarX size={16} aria-hidden="true" /> No hay fechas bloqueadas desde hoy.</p>
        ) : (
          <ul className="bloqueos-items">
            {porFecha.map(([fecha, items]) => (
              <li key={fecha} className={`bloqueos-dia ${fecha === desde ? 'is-current' : ''}`}>
                <span className="bloqueos-dia-fecha">{fechaLarga(fecha)}</span>
                <ul>
                  {items.map((b) => {
                    const ocupado = desbloqueando.has(String(b.id))
                    const quien = b.barbero_id == null ? 'Todo el negocio' : nombreBarbero(b.barbero_id)
                    return (
                      <li key={b.id} className="bloqueos-item">
                        <span className="bloqueos-item-info">
                          <strong>{quien}</strong>
                          <span>{b.motivo}</span>
                          <Badge variant={esBloqueoDiaCompleto(b) ? 'danger' : 'warning'}>{esBloqueoDiaCompleto(b) ? 'Todo el día' : `Parcial · ${rangoBloqueo(b)}`}</Badge>
                        </span>
                        {onDesbloquear && (
                          <Button
                            size="sm"
                            variant="default"
                            className="bloqueos-unblock"
                            aria-disabled={ocupado || undefined}
                            aria-label={`Desbloquear el ${fechaEnTexto(fecha)} para ${quien}`}
                            onClick={() => desbloquear(b)}
                          >
                            <LockOpen size={14} aria-hidden="true" />{ocupado ? 'Desbloqueando…' : 'Desbloquear'}
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
  )
}
