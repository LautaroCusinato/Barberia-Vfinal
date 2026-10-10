import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TurnoOriginBadge from './TurnoOriginBadge.jsx'

describe('TurnoOriginBadge', () => {
  it('etiqueta sólo los orígenes conocidos: Web y WhatsApp', () => {
    const { rerender, container } = render(<TurnoOriginBadge origen="reserva_web" />)
    expect(screen.getByText('Web')).toBeInTheDocument()
    expect(container.querySelector('.origen-badge--web')).not.toBeNull()
    rerender(<TurnoOriginBadge origen="whatsapp" />)
    expect(screen.getByText('WhatsApp')).toBeInTheDocument()
    expect(container.querySelector('.origen-badge--wsp')).not.toBeNull()
  })

  it.each([
    ['panel', 'turno cargado desde el panel'],
    [undefined, 'turno sin origen'],
    [null, 'origen nulo'],
    ['desconocido', 'origen no reconocido'],
    ['', 'origen vacío'],
  ])('no etiqueta %s (%s)', (origen) => {
    const { container } = render(<TurnoOriginBadge origen={origen} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('el indicador compacto de semana conserva el título y no muestra texto visible', () => {
    const { container, rerender } = render(<TurnoOriginBadge origen="reserva_web" compact />)
    const web = container.querySelector('.origen-indicator--web')
    expect(web).toHaveAttribute('title', 'Agendado desde la web')
    expect(web).toHaveAttribute('aria-label', 'Agendado desde la web')
    expect(web).toBeEmptyDOMElement()
    rerender(<TurnoOriginBadge origen="whatsapp" compact />)
    expect(container.querySelector('.origen-indicator--wsp')).toHaveAttribute('title', 'Agendado por WhatsApp')
  })
})
