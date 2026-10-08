const idIgual = (a, b) => a != null && b != null && String(a) === String(b)
const mismoNegocio = (nota, cliente) => nota.barberia_id == null || cliente.barberia_id == null || idIgual(nota.barberia_id, cliente.barberia_id)

// Notas anteriores a la tarea 43: el alta nunca guardaba cliente_id y la
// ficha las mostraba por nombre. Se siguen mostrando en la ficha sólo si un
// único cliente del negocio tiene exactamente ese nombre (sin escribir nada);
// con homónimos quedan sin atribuir, visibles en Todas las notas.
export function clienteLegadoDeNota(nota, clientes = []) {
  if (!nota || nota.cliente_id != null) return null
  const nombre = String(nota.paciente ?? '').trim()
  if (!nombre || nombre === 'General') return null
  const candidatos = (clientes || []).filter((cliente) => String(cliente.nombre ?? '').trim() === nombre && mismoNegocio(nota, cliente))
  return candidatos.length === 1 ? candidatos[0] : null
}

// Con la lista de clientes se reconoce también el vínculo por nombre de una
// nota anterior; sin ella sólo cuenta el cliente_id.
export function notaDelCliente(nota, cliente, clientes = null) {
  if (!cliente || !nota) return false
  if (nota.cliente_id != null) return idIgual(nota.cliente_id, cliente.id) && mismoNegocio(nota, cliente)
  return Array.isArray(clientes) && idIgual(clienteLegadoDeNota(nota, clientes)?.id, cliente.id)
}

export function clienteDeNota(nota, clientes = []) {
  if (nota?.cliente_id == null) return clienteLegadoDeNota(nota, clientes)
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
