const NORMALIZED_STATES = new Set(['open', 'connected', 'connecting', 'close', 'closed'])

export function normalizeEvolutionState(value) {
  const state = String(value || '').trim().toLowerCase()
  return NORMALIZED_STATES.has(state) ? state : null
}

function hadPreviousConnection({ receiverNumber, metadata = {} }) {
  return Boolean(
    String(receiverNumber || '').trim()
    || metadata?.ever_connected === true
    || metadata?.last_connected_at,
  )
}

function qrStillAvailable(qrExpiresAt, now) {
  const expires = qrExpiresAt ? Date.parse(String(qrExpiresAt)) : NaN
  return Number.isFinite(expires) && expires > now
}

/**
 * Evolution 2.3.7 exposes two different views of a not-yet-paired instance:
 * connectionState can remain `close` while fetchInstances reports `connecting`.
 * This resolver is the sole translation boundary into Austral's state machine.
 */
export function resolveEvolutionState({
  connectionState,
  fetchState,
  previousState,
  receiverNumber,
  metadata,
  qrExpiresAt,
  now = Date.now(),
} = {}) {
  const connection = normalizeEvolutionState(connectionState)
  const fetched = normalizeEvolutionState(fetchState)
  const priorConnected = hadPreviousConnection({ receiverNumber, metadata })
  const cachedQr = qrStillAvailable(qrExpiresAt, now)

  if (connection === 'open' && (!fetched || fetched === 'open' || fetched === 'connected')) {
    return { state: 'CONNECTED', reason: 'connection_open' }
  }

  // Never infer a live session from contradictory signals.
  if (connection === 'open' && fetched && !['open', 'connected'].includes(fetched)) {
    return { state: 'ERROR', reason: 'contradictory_connected_signals' }
  }

  // `fetchInstances=connecting` means Evolution is waiting for QR/pairing,
  // even when connectionState still says `close`.
  if (fetched === 'connecting' || connection === 'connecting') {
    if (previousState === 'QR_READY' && cachedQr) return { state: 'QR_READY', reason: 'qr_still_valid' }
    return { state: 'CONNECTING', reason: priorConnected ? 'reconnect_in_progress' : 'pairing_in_progress' }
  }

  // Preserve an unexpired QR state if both read-only signals are temporarily
  // unavailable. This avoids turning a pending pairing into a false logout.
  if (cachedQr && ['QR_READY', 'CONNECTING'].includes(previousState)) {
    return { state: previousState, reason: 'cached_qr_state' }
  }

  if (connection === 'close' || fetched === 'close' || fetched === 'closed') {
    return { state: priorConnected ? 'DISCONNECTED' : 'DISCONNECTED', reason: priorConnected ? 'previous_session_closed' : 'not_connected' }
  }

  return { state: 'ERROR', reason: 'unknown_evolution_state' }
}
