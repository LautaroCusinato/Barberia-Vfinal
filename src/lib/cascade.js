// Entrada en cascada de los primeros elementos de una lista, sólo la primera
// vez que se abre cada pantalla (ni al filtrar ni al volver a ella).
const ELEMENTOS = '.agenda-item, .client-mobile-card, .management-table tbody tr, .conv-item, .note-card, .barbero-card'
const MAXIMO = 8
const PASO_MS = 40
const DURACION_MS = 240

export function cascadaInicial(contenedor) {
  if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true
  const items = [...contenedor.querySelectorAll(ELEMENTOS)].filter((el) => el.getClientRects().length > 0).slice(0, MAXIMO)
  if (items.length === 0) return false
  items.forEach((el, i) => {
    el.style.setProperty('--cascade-delay', `${i * PASO_MS}ms`)
    el.classList.add('cascade-item')
  })
  // Se quita siempre: si el navegador no llegó a animar, nada queda invisible.
  window.setTimeout(() => items.forEach((el) => {
    el.classList.remove('cascade-item')
    el.style.removeProperty('--cascade-delay')
  }), MAXIMO * PASO_MS + DURACION_MS + 80)
  return true
}
