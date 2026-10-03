// Duración del colapso de una fila antes de quitarla de la lista (--motion-base).
const COLAPSO_MS = 240

// Deja que la fila termine de colapsarse y recién entonces la quita.
// Con movimiento reducido el cambio es inmediato.
export function despuesDelColapso(accion) {
  const reducido = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  return setTimeout(accion, reducido ? 0 : COLAPSO_MS)
}
