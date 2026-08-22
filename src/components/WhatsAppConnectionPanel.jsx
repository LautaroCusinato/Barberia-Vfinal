import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleAlert, Link2, LoaderCircle, MessageCircle, Power, RefreshCw, ShieldCheck, Unplug } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'

const STATE_COPY = {
  NOT_CONFIGURED: { label: 'No configurado', tone: 'neutral', description: 'Conectá el canal desde acá cuando tu equipo esté listo.' },
  CREATING_INSTANCE: { label: 'Preparando conexión', tone: 'pending', description: 'Estamos preparando una conexión aislada para este negocio.' },
  QR_READY: { label: 'Listo para vincular', tone: 'pending', description: 'Escaneá el código desde el teléfono autorizado para completar la conexión.' },
  CONNECTING: { label: 'Conectando', tone: 'pending', description: 'Estamos verificando la conexión. Podés dejar esta pantalla abierta.' },
  CONNECTED: { label: 'Conectado', tone: 'success', description: 'La conexión está lista. Los mensajes siguen sujetos a la configuración y autorización del negocio.' },
  DISCONNECTED: { label: 'Desconectado', tone: 'neutral', description: 'El canal está desconectado. Podés volver a vincularlo cuando quieras.' },
  ERROR: { label: 'Necesita atención', tone: 'error', description: 'No pudimos completar la conexión. Revisá el estado e intentá nuevamente.' },
}

function safeMessage(error) {
  const message = String(error?.message || '').replace(/[\r\n]/g, ' ')
  if (/owner|admin|gestionar|autentic|sesión/i.test(message)) return 'Sólo owner o admin puede gestionar esta conexión.'
  if (/configuración|disponible|provider|provision/i.test(message)) return 'La conexión todavía requiere configuración operativa.'
  return 'No pudimos actualizar la conexión. Intentá nuevamente en unos segundos.'
}

export default function WhatsAppConnectionPanel({ barberiaId, demoMode = false }) {
  const [connection, setConnection] = useState(null)
  const [loading, setLoading] = useState(!demoMode && isSupabaseConfigured)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const state = connection?.state || 'NOT_CONFIGURED'
  const copy = STATE_COPY[state] || STATE_COPY.ERROR
  const canConnect = !working && ['NOT_CONFIGURED', 'DISCONNECTED', 'ERROR', 'QR_READY'].includes(state)
  const canDisconnect = !working && ['CONNECTED', 'QR_READY', 'CONNECTING'].includes(state)
  const qrVisible = Boolean(connection?.qr_available && connection?.qr)

  const invoke = useCallback(async (action) => {
    if (demoMode || !isSupabaseConfigured) return
    setWorking(true); setError(''); setNotice('')
    const { data, error: invokeError } = await supabase.functions.invoke('whatsapp-provision', { body: { action, tenant_id: barberiaId } })
    if (invokeError || data?.error) {
      setError(safeMessage(invokeError || data?.error))
    } else if (data?.connection) {
      setConnection(data.connection)
      setNotice(action === 'disconnect' ? 'WhatsApp quedó desconectado.' : data.connection.qr_available ? 'Conexión preparada. El código es temporal.' : 'Estado actualizado.')
    }
    setWorking(false)
  }, [barberiaId, demoMode])

  const load = useCallback(async () => {
    if (demoMode || !isSupabaseConfigured) { setLoading(false); return }
    setLoading(true); setError('')
    const { data, error: invokeError } = await supabase.functions.invoke('whatsapp-provision', { body: { action: 'status', tenant_id: barberiaId } })
    if (invokeError || data?.error) setError(safeMessage(invokeError || data?.error))
    else setConnection(data?.connection || null)
    setLoading(false)
  }, [barberiaId, demoMode])

  useEffect(() => { load() }, [load])

  const title = useMemo(() => demoMode ? 'WhatsApp en validación' : 'Conectar WhatsApp', [demoMode])

  if (loading) return <section className="panel whatsapp-connection-card" aria-busy="true"><LoaderCircle className="spin" size={18} /> Cargando estado de WhatsApp…</section>

  return <section className="panel whatsapp-connection-card" aria-labelledby="whatsapp-connection-title">
    <div className="panel-header-inline whatsapp-connection-header">
      <div><p className="panel-kicker">Canal de atención</p><h2 id="whatsapp-connection-title" className="panel-title"><MessageCircle size={17} /> {title}</h2><p className="panel-subtitle">La conexión se administra por negocio y nunca expone credenciales en el navegador.</p></div>
      <span className={`status-pill whatsapp-connection-pill whatsapp-connection-pill--${copy.tone}`}><span aria-hidden="true" /> {demoMode ? 'En validación' : copy.label}</span>
    </div>

    {error && <div className="error-banner" role="alert"><CircleAlert size={15} /> {error}</div>}
    {notice && <div className="settings-notice" role="status"><CheckCircle2 size={15} /> {notice}</div>}

    <div className="whatsapp-connection-body">
      <div className="whatsapp-connection-message"><ShieldCheck size={18} /><div><strong>{demoMode ? 'Disponible próximamente' : copy.label}</strong><p>{demoMode ? 'La demo no conecta servicios externos ni genera mensajes.' : copy.description}</p></div></div>
      {qrVisible && <div className="whatsapp-qr-wrap"><div className="whatsapp-qr-heading"><strong>Código temporal</strong><small>Vence en unos minutos. No compartas esta pantalla.</small></div><div className="whatsapp-qr-frame"><img src={connection.qr} alt="Código temporal para vincular WhatsApp" /></div></div>}
      {connection?.provisioning_mode === 'mock' && !demoMode && <div className="whatsapp-connection-note" role="status"><Link2 size={15} /> Este estado es una simulación QA; no requiere ni permite escaneo real.</div>}
    </div>

    <div className="whatsapp-connection-actions">
      {!demoMode && <button type="button" className="btn btn-primary" onClick={() => invoke(state === 'ERROR' || state === 'DISCONNECTED' ? 'reconnect' : 'connect')} disabled={!canConnect}>{working ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} {state === 'NOT_CONFIGURED' ? 'Preparar conexión' : 'Volver a conectar'}</button>}
      {canDisconnect && !demoMode && <button type="button" className="btn" onClick={() => invoke('disconnect')}><Unplug size={15} /> Desconectar</button>}
      {!demoMode && <button type="button" className="btn btn-ghost" onClick={load} disabled={working}><Power size={15} /> Actualizar estado</button>}
    </div>
  </section>
}
