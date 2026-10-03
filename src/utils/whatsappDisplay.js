const CONNECTION_COPY = {
  checking: { label: 'Verificando…', title: 'Verificando WhatsApp…', badge: 'Verificando' },
  connected: { label: 'Conectado', title: 'WhatsApp conectado', badge: 'Conectado' },
  connecting: { label: 'Conectando…', title: 'WhatsApp conectando…', badge: 'Conectando' },
  'qr-ready': { label: 'QR listo', title: 'WhatsApp listo para vincular', badge: 'QR listo' },
  error: { label: 'Error de conexión', title: 'WhatsApp con error de conexión', badge: 'Error' },
  disconnected: { label: 'Desconectado', title: 'WhatsApp desconectado', badge: 'Desconectado' },
  'needs-config': { label: 'Requiere configuración', title: 'Conectar WhatsApp', badge: 'Requiere configuración' },
  unavailable: { label: 'Estado no disponible', title: 'No pudimos verificar WhatsApp', badge: 'Sin verificar' },
}

function normalizeConnectionState({ connected, configured, connectionStatus, estado, statusUnavailable }) {
  const raw = String(connectionStatus || estado || '').trim().toLowerCase().replaceAll('_', '-')
  if (connected || raw === 'connected' || raw === 'conectado') return 'connected'
  if (statusUnavailable || ['status-unavailable', 'unknown', 'unavailable'].includes(raw)) return 'unavailable'
  if (raw === 'connecting' || raw === 'conectando') return 'connecting'
  if (raw === 'qr-ready' || raw === 'qr listo' || raw === 'qr_ready') return 'qr-ready'
  if (raw === 'error' || raw === 'failed' || raw === 'fallido') return 'error'
  if (configured || raw === 'disconnected' || raw === 'desconectado') return 'disconnected'
  return 'needs-config'
}

export function getWhatsAppDisplayState({
  configured = false,
  connected = false,
  connectionStatus,
  estado,
  statusUnavailable = false,
  entitlement = 'allowed',
  entitlementLoading = false,
  automationEnabled = false,
  demoMode = false,
} = {}) {
  if (demoMode) {
    return {
      connectionState: 'requires-plan',
      connectionLabel: 'Disponible próximamente',
      connectionTitle: 'WhatsApp en validación',
      connectionBadge: 'En validación',
      entitlementLabel: 'Disponible próximamente · sin mensajes reales',
      automationLabel: null,
      requiresPlan: true,
      billingUnavailable: false,
      connectionUnavailable: false,
      connectionNotice: null,
      canConfigure: false,
      entitlementLoading: false,
      whatsappReady: false,
      resumen: { badge: 'Próximamente', descripcion: 'Disponible próximamente. La demo no envía mensajes.', tono: 'pendiente' },
    }
  }

  const technicalState = normalizeConnectionState({ connected, configured, connectionStatus, estado, statusUnavailable })
  const connectionState = entitlementLoading && technicalState === 'needs-config' ? 'checking' : technicalState
  const requiresPlan = entitlement === 'blocked'
  const billingUnavailable = entitlement === 'unavailable'
  const technicallyConnected = technicalState === 'connected'
  const connectionUnavailable = technicalState === 'unavailable' || statusUnavailable
  const runtimeEnabled = automationEnabled === true
  const whatsappReady = technicallyConnected && configured && entitlement === 'allowed' && runtimeEnabled && !statusUnavailable
  const canConfigure = !connectionUnavailable && !entitlementLoading && ['needs-config', 'disconnected', 'error'].includes(technicalState)
  const copy = CONNECTION_COPY[connectionState] || CONNECTION_COPY.unavailable
  const entitlementLabel = requiresPlan
    ? technicallyConnected ? 'Automatización requiere plan' : 'Plan no habilitado para esta función'
      : billingUnavailable
        ? 'No pudimos verificar el plan'
        : entitlement === 'unknown'
          ? 'Plan pendiente de verificación'
          : null
  const automationLabel = technicallyConnected && !runtimeEnabled
    ? 'Automatización pendiente de habilitación'
    : null

  // Un único estado para mostrar: antes el panel lateral decía a la vez
  // "WhatsApp conectado", "Conectado" y "Automatización pendiente de habilitación".
  const DESCRIPCION = {
    checking: 'Estamos verificando la conexión.',
    connecting: 'Conectando con WhatsApp…',
    'qr-ready': 'Escaneá el código QR desde Configuración.',
    error: 'Hubo un problema con la conexión. Revisala en Configuración.',
    disconnected: 'Volvé a vincular el número desde Configuración.',
    'needs-config': 'Vinculá el WhatsApp del negocio desde Configuración.',
    unavailable: 'No pudimos verificar el estado de WhatsApp.',
  }
  const resumen = connectionUnavailable
    ? { badge: 'Sin verificar', descripcion: DESCRIPCION.unavailable, tono: 'alerta' }
    : requiresPlan
      ? { badge: 'Requiere plan', descripcion: 'Activá un plan para usar WhatsApp.', tono: 'pendiente' }
      : billingUnavailable
        ? { badge: 'Sin verificar', descripcion: 'No pudimos verificar tu plan.', tono: 'alerta' }
        : whatsappReady
          ? { badge: 'Activo', descripcion: 'Responde y confirma turnos automáticamente.', tono: 'ok' }
          : technicallyConnected
            ? { badge: 'Conectado', descripcion: 'Respondés desde Mensajes; las respuestas automáticas se activan pronto.', tono: 'ok' }
            : { badge: copy.badge, descripcion: DESCRIPCION[connectionState] || DESCRIPCION.unavailable, tono: connectionState === 'error' ? 'alerta' : 'pendiente' }

  return {
    resumen,
    connectionState,
    connectionLabel: copy.label,
    connectionTitle: copy.title,
    connectionBadge: copy.badge,
    connectionUnavailable,
    connectionNotice: statusUnavailable && technicallyConnected ? 'No pudimos verificar el estado más reciente.' : null,
    canConfigure,
    entitlementLabel,
    automationLabel,
    requiresPlan,
    billingUnavailable,
    entitlementLoading,
    whatsappReady,
  }
}
