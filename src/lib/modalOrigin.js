// Recuerda el último botón que se tocó para que el modal que abra "crezca"
// desde ahí. Sólo vale por un instante: un modal que se abre solo (sin clic
// reciente) usa la entrada de siempre.
const VIGENCIA_MS = 1200
let ultimo = null

if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    const boton = event.target?.closest?.('button, a, [role="button"]')
    if (!boton) return
    const r = boton.getBoundingClientRect()
    ultimo = { x: r.left + r.width / 2, y: r.top + r.height / 2, t: Date.now() }
  }, true)
}

export function tomarOrigenModal() {
  const origen = ultimo
  ultimo = null
  if (!origen || Date.now() - origen.t > VIGENCIA_MS) return null
  return origen
}
