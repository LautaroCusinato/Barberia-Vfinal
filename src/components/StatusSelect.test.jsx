import { useEffect, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import StatusSelect, { STATUS_OPTIONS, statusMeta } from './StatusSelect'
import { FocusTrap } from './ui'

const boton = (estado) => screen.getByRole('button', {
  name: { confirmado: 'Marcar como confirmado', atendido: 'Marcar como atendido', no_asistio: 'Marcar como faltó o cancelado' }[estado],
})

describe('statusMeta', () => {
  it('sólo hay tres estados reales', () => {
    expect(STATUS_OPTIONS.map((option) => option.value)).toEqual(['confirmado', 'atendido', 'no_asistio'])
  })

  it('mapea estados heredados', () => {
    expect(statusMeta('atendido').value).toBe('atendido')
    expect(statusMeta('cancelado').value).toBe('no_asistio')
    expect(statusMeta('pendiente').value).toBe('confirmado')
    expect(statusMeta('en_atencion').value).toBe('confirmado')
    expect(statusMeta(undefined).value).toBe('confirmado')
  })
})

describe('StatusSelect', () => {
  it('marca como activo el estado actual (incluidos los heredados)', () => {
    const { rerender } = render(<StatusSelect value="atendido" onChange={() => {}} />)
    expect(boton('atendido')).toHaveClass('active')
    expect(boton('confirmado')).not.toHaveClass('active')
    rerender(<StatusSelect value="cancelado" onChange={() => {}} />)
    expect(boton('no_asistio')).toHaveClass('active')
    rerender(<StatusSelect value="pendiente" onChange={() => {}} />)
    expect(boton('confirmado')).toHaveClass('active')
  })

  it('no llama a onChange al tocar el estado actual', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StatusSelect value="confirmado" onChange={onChange} />)
    await user.click(boton('confirmado'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('bloquea los botones mientras guarda y los libera al terminar', async () => {
    const user = userEvent.setup()
    let resolver
    const onChange = vi.fn(() => new Promise((resolve) => { resolver = resolve }))
    const { container } = render(<StatusSelect value="confirmado" onChange={onChange} />)

    await user.click(boton('atendido'))
    expect(onChange).toHaveBeenCalledWith('atendido')
    expect(container.firstChild).toHaveAttribute('aria-busy', 'true')
    expect(boton('no_asistio')).toHaveAttribute('aria-disabled', 'true')
    await user.click(boton('no_asistio'))
    expect(onChange).toHaveBeenCalledTimes(1)

    resolver(true)
    await vi.waitFor(() => expect(boton('no_asistio')).toHaveAttribute('aria-disabled', 'false'))
    expect(container.firstChild).toHaveAttribute('aria-busy', 'false')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('avisa si el guardado devuelve false', async () => {
    const user = userEvent.setup()
    render(<StatusSelect value="confirmado" onChange={vi.fn().mockResolvedValue(false)} />)
    await user.click(boton('no_asistio'))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo actualizar el estado. Intentá de nuevo.')
  })

  it('avisa un problema de conexión si el guardado falla y limpia el error al reintentar', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(true)
    render(<StatusSelect value="confirmado" onChange={onChange} />)
    await user.click(boton('atendido'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Revisá tu conexión')
    await user.click(boton('atendido'))
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('no propaga el clic a la fila del turno', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    render(<div onClick={onRowClick}><StatusSelect value="confirmado" onChange={vi.fn().mockResolvedValue(true)} /></div>)
    await user.click(boton('atendido'))
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('al cerrar un diálogo abierto desde "Atendido" el foco vuelve a ese botón', async () => {
    const user = userEvent.setup()
    const alMontar = vi.fn()
    function Dentro() {
      useEffect(() => { alMontar({ disparadorDeshabilitado: boton('atendido').disabled, activo: document.activeElement?.getAttribute('aria-label') }) }, [])
      return <button type="button">Dentro del diálogo</button>
    }
    function Caso() {
      const [abierto, setAbierto] = useState(false)
      return (
        <>
          <StatusSelect value="confirmado" onChange={async () => { setAbierto(true); return true }} />
          {abierto && (
            <FocusTrap onEscape={() => setAbierto(false)} role="dialog" aria-modal="true">
              <Dentro />
            </FocusTrap>
          )}
        </>
      )
    }
    render(<Caso />)
    await user.click(boton('atendido'))
    await screen.findByRole('dialog')
    expect(alMontar).toHaveBeenCalledWith({ disparadorDeshabilitado: false, activo: 'Marcar como atendido' })
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(boton('atendido')).toHaveFocus()
  })
})
