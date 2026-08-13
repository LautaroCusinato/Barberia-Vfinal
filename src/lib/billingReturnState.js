const RETURN_STATES = new Set(['success', 'pending', 'failure', 'cancel'])

const RETURN_MESSAGES = {
  success: 'Volvimos del proveedor. Estamos verificando el estado con el backend; esta pantalla no activa la suscripcion por si sola.',
  pending: 'La operacion quedo pendiente. El estado cambiara cuando llegue la confirmacion del proveedor.',
  failure: 'El checkout no quedo confirmado. El estado definitivo proviene del backend.',
  cancel: 'El checkout fue cancelado. El estado definitivo proviene del backend.',
}

/** Browser return parameters are UX-only hints; they never mutate billing state. */
export function getBillingReturnState(search = typeof window === 'undefined' ? '' : window.location.search) {
  const value = new URLSearchParams(search).get('billing')
  if (!RETURN_STATES.has(value)) return null
  return { kind: value, message: RETURN_MESSAGES[value] }
}

