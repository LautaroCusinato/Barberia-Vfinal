// Evolution rechaza logout con 400 cuando sólo hay un QR sin sesión vinculada.
// Cancelar esa instancia nueva y vacía permite empezar de nuevo desde el panel.
// Nunca borra una sesión con dueño, contactos, chats o mensajes.
export async function disconnectQaSession({ instanceName, request, signals }) {
  try {
    await request(`/instance/logout/${encodeURIComponent(instanceName)}`, { method: 'DELETE' })
  } catch (logoutError) {
    const rows = await request('/instance/fetchInstances')
    if (!Array.isArray(rows)) throw logoutError
    const row = rows.find(value => value.name === instanceName)
    if (!row) return
    const observed = await signals(instanceName)
    if (observed.connectionState === 'close' && observed.fetchState === 'close') return
    const emptyPending = instanceName === 'austral-qa-tenant-928'
      && !row.ownerJid && !row.number
      && ['close', 'connecting'].includes(observed.connectionState)
      && ['close', 'connecting'].includes(observed.fetchState)
      && ['Message', 'Chat', 'Contact'].every(key => row._count?.[key] === 0)
    if (!emptyPending) throw logoutError
    await request(`/instance/delete/${encodeURIComponent(instanceName)}`, { method: 'DELETE' })
    const after = await request('/instance/fetchInstances')
    if (!Array.isArray(after) || after.some(value => value.name === instanceName)) {
      throw Object.assign(new Error('No se pudo confirmar la desconexión.'), {status:502,code:'evolution_disconnect_not_confirmed'})
    }
    return
  }
  const observed = await signals(instanceName)
  if (observed.connectionState !== 'close' || observed.fetchState !== 'close') {
    throw Object.assign(new Error('No se pudo confirmar la desconexión.'), {status:502,code:'evolution_disconnect_not_confirmed'})
  }
}
