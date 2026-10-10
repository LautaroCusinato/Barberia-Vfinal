import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FocusTrap } from './index.jsx'

// Revisión 41: el componente compartido ahora prioriza [data-autofocus]. Sin
// ese atributo debe seguir enfocando el primer elemento, como antes.
describe('FocusTrap', () => {
  it('sin [data-autofocus] enfoca el primer elemento enfocable', async () => {
    render(<FocusTrap><button type="button">Cerrar</button><input aria-label="Campo" /></FocusTrap>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus())
  })

  it('[data-autofocus] gana aunque aparezca después en el DOM', async () => {
    render(<FocusTrap><button type="button">Cerrar</button><input aria-label="Campo" data-autofocus /></FocusTrap>)
    await waitFor(() => expect(screen.getByLabelText('Campo')).toHaveFocus())
  })

  it('cerrado no mueve el foco', async () => {
    render(<><button type="button">Fuera</button><FocusTrap open={false}><input aria-label="Campo" data-autofocus /></FocusTrap></>)
    screen.getByRole('button', { name: 'Fuera' }).focus()
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByRole('button', { name: 'Fuera' })).toHaveFocus()
  })

  it('un formulario ocupado sin controles activos conserva el foco y bloquea Tab', async () => {
    render(<><button>Fuera</button><FocusTrap role="dialog" aria-label="Guardando"><input aria-label="Monto" disabled data-autofocus /></FocusTrap></>)
    const dialog = screen.getByRole('dialog', { name: 'Guardando' })
    await waitFor(() => expect(dialog).toHaveFocus())
    expect(fireEvent.keyDown(document, { key: 'Tab', cancelable: true })).toBe(false)
    expect(dialog).toHaveFocus()
  })

  it('ignora data-autofocus deshabilitado y enfoca un control disponible', async () => {
    render(<FocusTrap><input disabled data-autofocus aria-label="Monto" /><button>Cancelar</button></FocusTrap>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus())
  })

  it('recupera el foco si queda afuera mientras el modal está abierto', async () => {
    render(<><button>Fuera</button><FocusTrap><button>Primero</button><button>Último</button></FocusTrap></>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Primero' })).toHaveFocus())
    screen.getByRole('button', { name: 'Fuera' }).focus()
    expect(fireEvent.keyDown(document, { key: 'Tab', cancelable: true })).toBe(false)
    expect(screen.getByRole('button', { name: 'Primero' })).toHaveFocus()
  })
})
