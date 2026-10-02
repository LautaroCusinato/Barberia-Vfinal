// Todos los tonos dan >= 4.5:1 con texto blanco (#B5651D quedaba en 4.3).
const PALETTE = ['#2F5D50', '#8A5C1F', '#8A4A3D', '#3D5A80', '#6B5B95', '#1F4038', '#9A5418']

export function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function colorFor(name = '') {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

// Color de texto legible sobre un fondo arbitrario (p. ej. el color elegido
// para cada barbero): blanco o casi negro, el que dé más contraste.
export function textoSobre(hex = '') {
  const value = String(hex || '').trim().replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  if (!/^[0-9a-f]{6}$/i.test(full)) return 'var(--on-accent)'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return (1.05 / (lum + 0.05)) >= ((lum + 0.05) / 0.0581) ? '#FFFFFF' : '#1C150C'
}
