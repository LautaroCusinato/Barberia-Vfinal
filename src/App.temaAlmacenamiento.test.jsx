import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/demoStore.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, saveDemoSnapshot: vi.fn(), getDemoSnapshot: () => original.getDemoSnapshot('56-local') }
})

import App from './App.jsx'

const rechazo = (nombre) => () => { throw new DOMException('Almacenamiento no disponible', nombre) }

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  document.documentElement.removeAttribute('data-theme')
  window.history.replaceState({}, '', '/demo?view=agenda')
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function abrirPanel() {
  render(<App barberiaId={0} barberiaNombre="Demo" demoMode demoSessionId="56-local" />)
  return screen.findByRole('heading', { name: 'Agenda' })
}

describe('App: el tema es una preferencia opcional (56)', () => {
  it('con la escritura rechazada (cuota) el panel abre y el tema cambia en memoria', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(rechazo('QuotaExceededError'))
    expect(await abrirPanel()).toBeInTheDocument()
    const antes = document.documentElement.getAttribute('data-theme')
    expect(['light', 'dark']).toContain(antes)
    fireEvent.click(screen.getAllByRole('button', { name: antes === 'dark' ? 'Modo oscuro' : 'Modo claro' })[0])
    expect(document.documentElement.getAttribute('data-theme')).toBe(antes === 'dark' ? 'light' : 'dark')
    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument()
  })

  it('con la lectura rechazada (seguridad) usa el tema del sistema y el panel abre', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(rechazo('SecurityError'))
    expect(await abrirPanel()).toBeInTheDocument()
    expect(['light', 'dark']).toContain(document.documentElement.getAttribute('data-theme'))
  })

  it('un valor guardado inválido no llega a data-theme', async () => {
    const original = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      return /theme/i.test(String(key)) ? '<script>' : original.call(this, key)
    })
    await abrirPanel()
    expect(['light', 'dark']).toContain(document.documentElement.getAttribute('data-theme'))
  })
})
