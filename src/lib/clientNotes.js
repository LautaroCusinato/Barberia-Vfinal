const idIgual = (a, b) => a != null && b != null && String(a) === String(b)

export function notaDelCliente(nota, cliente) {
  if (!cliente || !idIgual(nota.cliente_id, cliente.id)) return false
  return nota.barberia_id == null || cliente.barberia_id == null || idIgual(nota.barberia_id, cliente.barberia_id)
}

export function clienteDeNota(nota, clientes = []) {
  return clientes.find((cliente) => notaDelCliente(nota, cliente)) || null
}

export function nombreDeNota(nota, clientes = []) {
  return clienteDeNota(nota, clientes)?.nombre || nota.paciente || 'General'
}

export function etiquetaClienteNota(cliente, clientes = []) {
  const iguales = clientes.filter((item) => item.nombre === cliente.nombre)
  if (iguales.length < 2) return cliente.nombre
  const digits = String(cliente.telefono || '').replace(/\D/g, '')
  return `${cliente.nombre} · ${digits ? `…${digits.slice(-4)}` : `ficha ${iguales.findIndex((item) => idIgual(item.id, cliente.id)) + 1}`}`
}

// El navegador aporta una selección, no autoridad sobre el negocio. App
// resuelve la ficha actual y la base vuelve a validar tenant y permisos.
export function asociacionNota(selection, clientes = [], textoLibre = '') {
  if (selection === '__general__') return { cliente_id: null, paciente: 'General' }
  if (selection === '__otro__') return { cliente_id: null, paciente: textoLibre.trim() || 'General' }
  const cliente = clientes.find((item) => idIgual(item.id, selection))
  return cliente ? { cliente_id: cliente.id, paciente: cliente.nombre } : null
}
