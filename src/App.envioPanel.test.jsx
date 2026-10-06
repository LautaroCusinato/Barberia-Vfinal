// Panel completo (App) con un Supabase falso en memoria: envío manual de la
// tarea 38 frente a un cambio de negocio con el envío en curso, la pausa del
// bot ante un rechazo, su reanudación explícita y los resultados inciertos.
// No habla con ningún servicio: `supabaseClient` se reemplaza en este archivo.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const falso = vi.hoisted(() => {
  const estado = { db: {}, llamadas: [], envios: [], rpcs: [] }
  const coincide = (fila, filtros) => Object.entries(filtros).every(([k, v]) => !(k in fila) || fila[k] === v)
  const resolver = (q) => {
    estado.llamadas.push(q)
    if (q.op === 'upsert') return { data: [{ ...q.payload }], error: null }
    if (q.op !== 'select') return { data: q.payload ? [{ ...q.payload }] : null, error: null }
    const filas = (estado.db[q.table] || []).filter((fila) => coincide(fila, q.filtros)).map((fila) => ({ ...fila }))
    if (q.maybe) return { data: filas[0] ?? null, error: null }
    if (q.single) return { data: filas[0] ?? null, error: filas[0] ? null : { code: 'PGRST116' } }
    return { data: filas, error: null }
  }
  const from = (table) => {
    const q = { table, filtros: {}, op: 'select', payload: null }
    const api = {
      select: () => api, in: () => api, order: () => api, limit: () => api, gte: () => api, lt: () => api, lte: () => api,
      eq: (k, v) => { q.filtros[k] = v; return api },
      insert: (p) => { q.op = 'insert'; q.payload = p; return api },
      update: (p) => { q.op = 'update'; q.payload = p; return api },
      upsert: (p) => { q.op = 'upsert'; q.payload = p; return api },
      delete: () => { q.op = 'delete'; return api },
      single: () => { q.single = true; return api },
      maybeSingle: () => { q.maybe = true; return api },
      then: (ok, ko) => Promise.resolve().then(() => resolver(q)).then(ok, ko),
    }
    return api
  }
  const canal = { on: () => canal, subscribe: (cb) => { cb?.('SUBSCRIBED'); return canal } }
  const supabase = {
    from,
    rpc: async (nombre, args) => {
      estado.rpcs.push({ nombre, args })
      if (nombre === 'get_billing_portal') return { data: { access_state: 'active' }, error: null }
      return { data: null, error: null }
    },
    functions: {
      invoke: (nombre, { body }) => {
        if (body?.action === 'preflight') return Promise.resolve({ data: { ready: true, contract: 2, cliente_id: body.cliente_id }, error: null })
        if (body?.action === 'send') {
          let resolve
          const promesa = new Promise((r) => { resolve = r })
          estado.envios.push({ body, resolve })
          return promesa
        }
        return Promise.resolve({ data: null, error: null })
      },
    },
    channel: () => canal,
    removeChannel: () => {},
    auth: { getSession: async () => ({ data: { session: null } }) },
    realtime: { setAuth: async () => {} },
  }
  return { estado, supabase }
})

vi.mock('/src/lib/supabaseClient.js', () => ({ supabase: falso.supabase, supabaseUrl: 'http://supabase.falso', isSupabaseConfigured: true }))

const { default: App } = await import('./App.jsx')

const CREADO = '2026-10-05T13:00:00.000Z'
function sembrar() {
  falso.estado.db = {
    barberias: [{ id: 1, nombre: 'Negocio A' }, { id: 2, nombre: 'Negocio B' }],
    clientes: [
      { id: 101, barberia_id: 1, nombre: 'Ana Uno', telefono: '5491111111111' },
      { id: 201, barberia_id: 2, nombre: 'Beto Dos', telefono: '5492222222222' },
    ],
    mensajes: [
      { id: 1, barberia_id: 1, cliente_id: 101, paciente: 'Ana Uno', texto: 'Consulta de A', de: 'paciente', hora: '10:00', leido: true, created_at: CREADO },
      { id: 2, barberia_id: 2, cliente_id: 201, paciente: 'Beto Dos', texto: 'Consulta de B', de: 'paciente', hora: '10:00', leido: true, created_at: CREADO },
    ],
    config: [
      { barberia_id: 1, clave: 'bot_activo', valor: 'true' },
      { barberia_id: 2, clave: 'bot_activo', valor: 'true' },
    ],
    saas_integraciones: [
      { barberia_id: 1, proveedor: 'evolution', estado: 'conectado', metadata: { automation_enabled: true } },
      { barberia_id: 2, proveedor: 'evolution', estado: 'conectado', metadata: { automation_enabled: true } },
    ],
  }
  falso.estado.llamadas = []
  falso.estado.envios = []
  falso.estado.rpcs = []
}

const errorDeFuncion = (status, body) => ({ data: null, error: { context: new Response(JSON.stringify(body), { status }) } })
const BANNER_PAUSA = /El bot de WhatsApp está en pausa/

async function abrirHilo(nombre) {
  const lista = await screen.findByRole('list', {}, { timeout: 5000 }).catch(() => null)
  const item = (lista ? within(lista).queryAllByText(nombre) : []).at(0) || (await screen.findAllByText(nombre, {}, { timeout: 5000 }))[0]
  fireEvent.click(item.closest('button, [role="button"], li') || item)
  return screen.findByLabelText(`Mensaje para ${nombre}`)
}

async function escribirYEnviar(nombre, texto) {
  const compositor = await abrirHilo(nombre)
  fireEvent.change(compositor, { target: { value: texto } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  return compositor
}

beforeEach(() => {
  sembrar()
  window.history.replaceState(null, '', '/?view=mensajes')
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('cambio de negocio con un envío en curso', () => {
  it('la respuesta tardía del negocio anterior no toca el hilo, el borrador ni el bot del negocio actual', async () => {
    const { rerender } = render(<App barberiaId={1} barberiaNombre="Negocio A" />)
    await escribirYEnviar('Ana Uno', 'Hola A')
    await waitFor(() => expect(falso.estado.envios).toHaveLength(1))
    expect(falso.estado.envios[0].body).toMatchObject({ tenant_id: 1, cliente_id: 101, texto: 'Hola A' })

    rerender(<App barberiaId={2} barberiaNombre="Negocio B" />)
    const compositorB = await abrirHilo('Beto Dos')
    fireEvent.change(compositorB, { target: { value: 'Borrador de B' } })

    await act(async () => {
      falso.estado.envios[0].resolve({
        data: {
          sent: true, contract: 2, estado_envio: 'recibido_n8n', bot_paused: true,
          mensaje: { id: 900, barberia_id: 1, cliente_id: 101, paciente: 'Ana Uno', texto: 'Hola A', de: 'clinica', hora: '10:05', leido: true, estado_envio: 'recibido_n8n', created_at: CREADO },
        },
        error: null,
      })
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(screen.queryByText('Ana Uno')).not.toBeInTheDocument()
    expect(screen.queryByText('Hola A')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Mensaje para Beto Dos')).toHaveValue('Borrador de B')
    expect(screen.queryByText(BANNER_PAUSA)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('un rechazo tardío del negocio anterior no muestra avisos ni pausa en el negocio actual', async () => {
    const { rerender } = render(<App barberiaId={1} barberiaNombre="Negocio A" />)
    await escribirYEnviar('Ana Uno', 'Hola A')
    await waitFor(() => expect(falso.estado.envios).toHaveLength(1))

    rerender(<App barberiaId={2} barberiaNombre="Negocio B" />)
    const compositorB = await abrirHilo('Beto Dos')
    fireEvent.change(compositorB, { target: { value: 'Borrador de B' } })

    await act(async () => {
      falso.estado.envios[0].resolve(errorDeFuncion(502, { error: { code: 'panel_send_rejected', message: 'WhatsApp rechazó el envío.' }, contract: 2, bot_paused: true }))
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(screen.queryByText(/WhatsApp rechazó/)).not.toBeInTheDocument()
    expect(screen.queryByText(BANNER_PAUSA)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Mensaje para Beto Dos')).toHaveValue('Borrador de B')
    // El negocio anterior no recibe ninguna escritura extra desde la pantalla nueva.
    expect(falso.estado.rpcs.filter((r) => r.nombre === 'pause_whatsapp_bot_for_manual_reply')).toHaveLength(0)
  })
})

describe('rechazo del envío manual: el bot queda pausado y se puede reanudar', () => {
  it('reserva atómica: el servidor ya pausó; el panel lo muestra, conserva el borrador y el owner puede reanudar', async () => {
    render(<App barberiaId={1} barberiaNombre="Negocio A" />)
    const compositor = await escribirYEnviar('Ana Uno', 'Hola A')
    await waitFor(() => expect(falso.estado.envios).toHaveLength(1))
    await act(async () => {
      falso.estado.envios[0].resolve(errorDeFuncion(502, { error: { code: 'panel_send_rejected', message: 'WhatsApp rechazó el envío. El mensaje no salió y el borrador quedó guardado para reintentar.' }, contract: 2, bot_paused: true }))
    })
    expect(await screen.findByText(/WhatsApp rechazó el envío/)).toBeInTheDocument()
    expect(compositor).toHaveValue('Hola A')
    expect(await screen.findByText(BANNER_PAUSA)).toBeInTheDocument()
    // El servidor ya lo pausó: el navegador no repite la pausa.
    expect(falso.estado.rpcs.filter((r) => r.nombre === 'pause_whatsapp_bot_for_manual_reply')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Reanudar bot' }))
    await waitFor(() => expect(screen.queryByText(BANNER_PAUSA)).not.toBeInTheDocument())
    const reanudar = falso.estado.llamadas.filter((q) => q.table === 'config' && q.op === 'upsert')
    expect(reanudar).toHaveLength(1)
    expect(reanudar[0].payload).toEqual({ barberia_id: 1, clave: 'bot_activo', valor: 'true' })
  })

  it('sin la migración (el servidor no pausó): el panel pausa igual tras un rechazo del proveedor', async () => {
    render(<App barberiaId={1} barberiaNombre="Negocio A" />)
    await escribirYEnviar('Ana Uno', 'Hola A')
    await waitFor(() => expect(falso.estado.envios).toHaveLength(1))
    await act(async () => {
      falso.estado.envios[0].resolve(errorDeFuncion(502, { error: { code: 'panel_send_rejected', message: 'WhatsApp rechazó el envío.' }, contract: 2, bot_paused: false }))
    })
    expect(await screen.findByText(BANNER_PAUSA)).toBeInTheDocument()
    expect(falso.estado.rpcs.filter((r) => r.nombre === 'pause_whatsapp_bot_for_manual_reply')).toEqual([{ nombre: 'pause_whatsapp_bot_for_manual_reply', args: { p_barberia_id: 1 } }])
  })

  it('un bloqueo antes de intentar el envío (límite, teléfono) no pausa el bot', async () => {
    render(<App barberiaId={1} barberiaNombre="Negocio A" />)
    await escribirYEnviar('Ana Uno', 'Hola A')
    await waitFor(() => expect(falso.estado.envios).toHaveLength(1))
    await act(async () => {
      falso.estado.envios[0].resolve(errorDeFuncion(429, { error: { code: 'send_rate_limited', message: 'Se enviaron demasiados mensajes en el último minuto.' }, contract: 2 }))
    })
    expect(await screen.findByText(/demasiados mensajes/)).toBeInTheDocument()
    expect(screen.queryByText(BANNER_PAUSA)).not.toBeInTheDocument()
    expect(falso.estado.rpcs.filter((r) => r.nombre === 'pause_whatsapp_bot_for_manual_reply')).toHaveLength(0)
  })
})

describe('modo demostración con la instancia por negocio', () => {
  it('sigue funcionando sin backend: envía localmente, sin llamar a la función', async () => {
    render(<App demoMode demoSessionId="prueba-38" barberiaId="demo-prueba-38" barberiaNombre="Demo" />)
    const items = await screen.findAllByRole('button', {}, { timeout: 5000 })
    const conv = document.querySelector('.conv-item')
    expect(conv).not.toBeNull()
    fireEvent.click(conv)
    const compositor = await screen.findByLabelText(/^Mensaje para /)
    fireEvent.change(compositor, { target: { value: 'Mensaje de demo 38' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(within(document.querySelector('.thread')).getAllByText('Mensaje de demo 38')).toHaveLength(1))
    expect(compositor).toHaveValue('')
    expect(falso.estado.envios).toHaveLength(0)
    expect(items.length).toBeGreaterThan(0)
  })
})

describe('resultado incierto', () => {
  it('no se reenvía solo; el reintento del mismo texto pide confirmación y advierte que pudo haber salido', async () => {
    render(<App barberiaId={1} barberiaNombre="Negocio A" />)
    const compositor = await escribirYEnviar('Ana Uno', 'Hola A')
    await waitFor(() => expect(falso.estado.envios).toHaveLength(1))
    const fila = { id: 900, barberia_id: 1, cliente_id: 101, paciente: 'Ana Uno', texto: 'Hola A', de: 'clinica', hora: '10:05', leido: true, estado_envio: 'incierto', created_at: CREADO, client_message_id: falso.estado.envios[0].body.client_message_id }
    await act(async () => {
      falso.estado.envios[0].resolve({ data: { sent: false, uncertain: true, contract: 2, estado_envio: 'incierto', bot_paused: true, mensaje: fila }, error: null })
    })
    expect(await screen.findByText(/puede haber llegado/i)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 100))
    expect(falso.estado.envios).toHaveLength(1)

    // El operador reescribe el mismo texto: el servidor lo reconoce (mismo identificador).
    fireEvent.change(compositor, { target: { value: 'Hola A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(falso.estado.envios).toHaveLength(2))
    expect(falso.estado.envios[1].body.client_message_id).toBe(fila.client_message_id)
    expect(falso.estado.envios[1].body.confirm_resend).toBeUndefined()
    await act(async () => {
      falso.estado.envios[1].resolve({ data: { replay: true, sent: false, uncertain: true, estado_envio: 'incierto', contract: 2, mensaje: fila }, error: null })
    })
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/podría haber llegado/i)
    expect(alerta).toHaveTextContent(/dos veces/i)
    expect(compositor).toHaveValue('Hola A')

    fireEvent.click(within(alerta).getByRole('button', { name: /Enviar de todos modos/ }))
    await waitFor(() => expect(falso.estado.envios).toHaveLength(3))
    expect(falso.estado.envios[2].body).toMatchObject({ confirm_resend: true, client_message_id: fila.client_message_id })
  })
})
