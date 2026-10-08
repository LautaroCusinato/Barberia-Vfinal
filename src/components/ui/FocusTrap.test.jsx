import { render, screen, waitFor } from '@testing-library/react'
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
})
