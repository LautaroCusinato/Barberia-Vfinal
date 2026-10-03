// Ripple táctil delegado: UN solo listener de pointerdown en el documento.
// El círculo vive dentro de un "clip" absoluto (inset 0, overflow hidden,
// border-radius heredado) así nunca hace falta poner overflow: hidden en el
// host — importante para .agenda-item--enhanced, cuyos popovers desbordan.

export const RIPPLE_SELECTOR = [
  '.btn-primary',
  '.btn',
  '.ui-button',
  '.mobile-tab-item',
  '.conv-item',
  '.agenda-item--enhanced',
  '.client-mobile-card',
].join(', ')

const RIPPLE_FALLBACK_MS = 700
let installed = false

function isDisabled(host) {
  if (host.matches(':disabled, [aria-disabled="true"]')) return true
  return Boolean(host.closest('[aria-disabled="true"], fieldset:disabled'))
}

function reducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function spawnRipple(host, clientX, clientY) {
  const rect = host.getBoundingClientRect()
  if (!rect.width || !rect.height) return null

  if (window.getComputedStyle(host).position === 'static') host.classList.add('ripple-host')

  const clip = document.createElement('span')
  clip.className = 'ripple-clip'
  clip.setAttribute('aria-hidden', 'true')

  const size = Math.max(rect.width, rect.height)
  const circle = document.createElement('span')
  circle.className = 'ripple-circle'
  // El clip arranca en el padding box: descontamos el borde del host.
  const style = window.getComputedStyle(host)
  const borderLeft = parseFloat(style.borderLeftWidth) || 0
  const borderTop = parseFloat(style.borderTopWidth) || 0
  circle.style.width = `${size}px`
  circle.style.height = `${size}px`
  circle.style.left = `${clientX - rect.left - borderLeft - size / 2}px`
  circle.style.top = `${clientY - rect.top - borderTop - size / 2}px`

  clip.appendChild(circle)
  host.appendChild(clip)

  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    clip.remove()
  }
  circle.addEventListener('animationend', remove, { once: true })
  window.setTimeout(remove, RIPPLE_FALLBACK_MS)
  return clip
}

function onPointerDown(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  if (reducedMotion()) return
  const target = event.target
  if (!(target instanceof Element)) return
  const host = target.closest(RIPPLE_SELECTOR)
  if (!host || isDisabled(host)) return
  spawnRipple(host, event.clientX, event.clientY)
}

export function installRipple(root = typeof document !== 'undefined' ? document : null) {
  if (installed || !root) return () => {}
  installed = true
  root.addEventListener('pointerdown', onPointerDown, { passive: true })
  return () => {
    root.removeEventListener('pointerdown', onPointerDown)
    installed = false
  }
}
