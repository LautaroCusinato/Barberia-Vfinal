/**
 * Serializa escrituras por clave y conserva sólo la intención más reciente.
 * Cada callback se ejecuta en orden; si llegan nuevos valores mientras una
 * escritura está en vuelo, el loop salta directamente al último valor.
 */
export function enqueueLatest(map, key, value, execute) {
  const state = map[key] || { inFlight: false, latest: value, promise: null }
  state.latest = value
  map[key] = state

  if (state.inFlight) return state.promise

  state.inFlight = true
  state.promise = (async () => {
    while (true) {
      const valueToSave = state.latest
      await execute(valueToSave)
      if (state.latest === valueToSave) return
    }
  })().finally(() => {
    state.inFlight = false
    state.promise = null
  })
  return state.promise
}
