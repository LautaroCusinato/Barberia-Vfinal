import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import PhoneField from './PhoneField'
import { PREFIJO_AR, soloDigitos, telefonoNacionalValido } from '../lib/text'

function ControlledPhone({ initial = PREFIJO_AR, onValue = () => {} }) {
  const [value, setValue] = useState(initial)
  return (
    <PhoneField
      aria-label="Teléfono"
      value={value}
      onChange={(next) => {
        setValue(next)
        onValue(next)
      }}
    />
  )
}

describe('PhoneField', () => {
  it('muestra el prefijo fijo y un input numérico vacío', () => {
    const { container } = render(<ControlledPhone />)
    const input = screen.getByRole('textbox', { name: 'Teléfono' })
    expect(container.querySelector('.phone-prefix')).toHaveTextContent('+54 9')
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('type', 'tel')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('placeholder', '11 0000-0000')
  })

  it('formatea mientras se tipea y entrega el valor con prefijo', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<ControlledPhone onValue={onValue} />)
    const input = screen.getByRole('textbox', { name: 'Teléfono' })

    await user.type(input, '3515551234')

    expect(input).toHaveValue('351 555-1234')
    expect(onValue).toHaveBeenLastCalledWith('+54 9 351 555-1234')
    expect(telefonoNacionalValido(onValue.mock.lastCall[0])).toBe(true)
    expect(soloDigitos(onValue.mock.lastCall[0])).toBe('5493515551234')
  })

  it('usa área de 2 dígitos para el AMBA', async () => {
    const user = userEvent.setup()
    render(<ControlledPhone />)
    const input = screen.getByRole('textbox', { name: 'Teléfono' })
    await user.type(input, '1155221234')
    expect(input).toHaveValue('11 5522-1234')
  })

  it('no acepta más de 10 dígitos nacionales', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<ControlledPhone onValue={onValue} />)
    const input = screen.getByRole('textbox', { name: 'Teléfono' })
    await user.type(input, '115522123499')
    expect(input).toHaveValue('11 5522-1234')
    expect(onValue).toHaveBeenLastCalledWith('+54 9 11 5522-1234')
  })

  it('descarta letras y símbolos', async () => {
    const user = userEvent.setup()
    render(<ControlledPhone />)
    const input = screen.getByRole('textbox', { name: 'Teléfono' })
    await user.type(input, 'ab-c')
    expect(input).toHaveValue('')
    await user.type(input, '3x5y1')
    expect(input).toHaveValue('351')
  })

  it('al pegar un número completo con +54 9 lo deja bien formateado', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<ControlledPhone onValue={onValue} />)
    const input = screen.getByRole('textbox', { name: 'Teléfono' })
    await user.click(input)
    await user.paste('+54 9 11 5522-1234')
    expect(input).toHaveValue('11 5522-1234')
    expect(onValue).toHaveBeenLastCalledWith('+54 9 11 5522-1234')
  })

  it('muestra un valor guardado y tolera un valor vacío', () => {
    const { rerender } = render(<PhoneField aria-label="Teléfono" value="+54 9 351 555-1234" onChange={() => {}} />)
    expect(screen.getByRole('textbox', { name: 'Teléfono' })).toHaveValue('351 555-1234')
    rerender(<PhoneField aria-label="Teléfono" value="" onChange={() => {}} />)
    expect(screen.getByRole('textbox', { name: 'Teléfono' })).toHaveValue('')
  })

  it('combina las clases del contenedor y del input', () => {
    const { container } = render(<PhoneField className="modal-phone-field" value={PREFIJO_AR} onChange={() => {}} />)
    expect(container.firstChild).toHaveClass('phone-field', 'modal-phone-field')
    expect(screen.getByRole('textbox')).toHaveClass('text-input', 'phone-input')
  })
})
