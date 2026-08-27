const CONNECTION_COPY = {
  checking: { label: 'Verificando…', title: 'Verificando WhatsApp…', badge: 'Verificando' },
  connected: { label: 'Conectado', title: 'WhatsApp conectado', badge: 'Conectado' },
  connecting: { label: 'Conectando…', title: 'WhatsApp conectando…', badge: 'Conectando' },
  'qr-ready': { label: 'QR listo', title: 'WhatsApp listo para vincular', badge: 'QR listo' },
  error: { label: 'Error de conexión', title: 'WhatsApp con error de conexión', badge: 'Error' },
  disconnected: { label: 'Desconectado', title: 'WhatsApp desconectado', badge: 'Desconectado' },
  'needs-config': { label: 'Requiere configuración', title: 'Conectar WhatsApp', badge: 'Requiere configuración' },
}

function normalizeConnectionState({ connected, configured, connectionStatus, estado }) {
  const raw = String(connectionStatus || estado || '').trim().toLowerCase().replaceAll('_', '-')
  if (connected || raw === 'connected' || raw === 'conectado') return 'connected'
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
  entitlement = 'allowed',
  entitlementLoading = false,
  demoMode = false,
} = {}) {
  if (demoMode) {
    return {
      connectionState: 'requires-plan',
      connectionLabel: 'Disponible próximamente',
      connectionTitle: 'WhatsApp en validación',
      connectionBadge: 'En validación',
      entitlementLabel: 'Disponible próximamente · sin mensajes reales',
      requiresPlan: true,
      billingUnavailable: false,
      entitlementLoading: false,
      whatsappReady: false,
    }
  }

  const technicalState = normalizeConnectionState({ connected, configured, connectionStatus, estado })
  const connectionState = entitlementLoading && technicalState === 'needs-config' ? 'checking' : technicalState
  const requiresPlan = entitlement === 'blocked'
  const billingUnavailable = entitlement === 'unavailable'
  const technicallyConnected = technicalState === 'connected'
  const whatsappReady = technicallyConnected && configured && entitlement === 'allowed'
  const copy = CONNECTION_COPY[connectionState]
  const entitlementLabel = requiresPlan
    ? technicallyConnected ? 'Automatización requiere plan' : 'Plan no habilitado para esta función'
      : billingUnavailable
        ? 'No pudimos verificar el plan'
        : entitlement === 'unknown'
          ? 'Plan pendiente de verificación'
          : null

  return {
    connectionState,
    connectionLabel: copy.label,
    connectionTitle: copy.title,
    connectionBadge: copy.badge,
    entitlementLabel,
    requiresPlan,
    billingUnavailable,
    entitlementLoading,
    whatsappReady,
  }
}
