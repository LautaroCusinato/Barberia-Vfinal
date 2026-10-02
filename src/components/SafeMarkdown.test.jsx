import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SafeMarkdown, { stripMarkdown } from './SafeMarkdown'

describe('SafeMarkdown', () => {
  it('renderiza negrita con ** y __', () => {
    const { container } = render(<SafeMarkdown value="Turno **confirmado** para __mañana__ a las 10" />)
    const strong = [...container.querySelectorAll('strong')].map((node) => node.textContent)
    expect(strong).toEqual(['confirmado', 'mañana'])
    expect(container.querySelector('p')).toHaveTextContent('Turno confirmado para mañana a las 10')
  })

  it('agrupa líneas con - o * en una lista y separa párrafos', () => {
    const { container } = render(<SafeMarkdown value={'Opciones:\r\n- 10:00\n* **11:30**\n\nRespondé con el horario'} />)
    const paragraphs = [...container.querySelectorAll('p')].map((node) => node.textContent)
    expect(paragraphs).toEqual(['Opciones:', 'Respondé con el horario'])
    const items = screen.getAllByRole('listitem').map((node) => node.textContent)
    expect(items).toEqual(['10:00', '11:30'])
    expect(container.querySelectorAll('ul')).toHaveLength(1)
    expect(container.querySelector('li strong')).toHaveTextContent('11:30')
  })

  it('crea listas separadas cuando hay texto entre ellas', () => {
    const { container } = render(<SafeMarkdown value={'- a\ntexto\n- b'} />)
    expect(container.querySelectorAll('ul')).toHaveLength(2)
  })

  it('nunca interpreta HTML del mensaje: lo muestra como texto', () => {
    const malicioso = '<img src=x onerror="alert(1)"> **<script>alert(2)</script>**\n- <a href="javascript:alert(3)">clic</a>'
    const { container } = render(<SafeMarkdown value={malicioso} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container).toHaveTextContent('<img src=x onerror="alert(1)">')
    expect(container.querySelector('strong')).toHaveTextContent('<script>alert(2)</script>')
    expect(screen.getByRole('listitem')).toHaveTextContent('<a href="javascript:alert(3)">clic</a>')
  })

  it('tolera valores vacíos y combina la clase', () => {
    const { container } = render(<SafeMarkdown className="bubble-text" />)
    expect(container.firstChild).toHaveClass('safe-markdown', 'bubble-text')
    expect(container.firstChild).toBeEmptyDOMElement()
  })
})

describe('stripMarkdown', () => {
  it('quita marcas para las vistas previas', () => {
    expect(stripMarkdown('**Hola** __Ana__\n- primero\n* segundo')).toBe('Hola Ana\nprimero\nsegundo')
    expect(stripMarkdown()).toBe('')
  })
})
