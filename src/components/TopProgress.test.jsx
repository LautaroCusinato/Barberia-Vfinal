import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TopProgress from './TopProgress'
import { seguirProgreso } from '../lib/progress.js'

describe('TopProgress', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('no aparece si la operación termina antes de 400ms', async () => {
    render(<TopProgress />)
    let resolver
    act(() => { seguirProgreso(new Promise((r) => { resolver = r })) })
    await act(async () => { vi.advanceTimersByTime(300); resolver(); await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('aparece pasados 400ms y se completa al terminar', async () => {
    render(<TopProgress />)
    let resolver
    act(() => { seguirProgreso(new Promise((r) => { resolver = r })) })
    await act(async () => { vi.advanceTimersByTime(450) })
    expect(screen.getByRole('progressbar')).toHaveClass('top-progress--avanzando')
    await act(async () => { resolver(); await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByRole('progressbar')).toHaveClass('top-progress--completa')
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})
