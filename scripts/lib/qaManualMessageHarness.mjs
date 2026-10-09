// Doble de la RPC para pruebas del cableado TS. El SQL real se prueba aparte
// con PostgreSQL local, concurrencia, permisos y rollback.
export const qaManualMessageRpc = {
  registrar_mensaje_whatsapp_qa928(args, db) {
    db.panelPersistenceCalls = (db.panelPersistenceCalls || 0) + 1
    if (db.failPanelPersistOnCall === db.panelPersistenceCalls) throw new Error('forced_panel_persist_failure')
    if (db.failPanelPersistence > 0) { db.failPanelPersistence -= 1; throw new Error('forced_panel_persist_failure') }
    const connection = db.tables.saas_whatsapp_connections.find(row => Number(row.integration_id) === Number(args.p_integration_id))
    if (Number(connection?.barberia_id) !== 928) throw new Error('qa928_scope_required')
    db.tables.mensajes ||= []
    const phone = args.p_telefono
    const placeholder = `Contacto WhatsApp · …${phone.slice(-4)}`
    let cliente = db.tables.clientes.find(row => row.barberia_id === 928 && row.telefono === phone)
    if (!cliente) {
      cliente = { id: 700 + db.tables.clientes.length, barberia_id: 928, telefono: phone, nombre: args.p_customer_name || placeholder, whatsapp_nombre_pendiente: !args.p_customer_name }
      db.tables.clientes.push(cliente)
    }
    if (cliente.whatsapp_nombre_pendiente === true && args.p_customer_name) {
      if (cliente.nombre === placeholder || !cliente.nombre.trim()) cliente.nombre = args.p_customer_name
      cliente.whatsapp_nombre_pendiente = false
    }
    const existing = db.tables.mensajes.find(row => row.qa_whatsapp_integration_id === args.p_integration_id && row.qa_whatsapp_operation_id === args.p_operation_id)
    if (existing) {
      if (existing.texto !== args.p_texto || existing.telefono !== phone || existing.de !== args.p_de
        || (args.p_de === 'bot' && existing.whatsapp_id !== args.p_provider_message_id)) throw new Error('qa928_message_identity_conflict')
      return { status: 'replay', mensaje: { ...existing }, cliente: { ...cliente } }
    }
    const mensaje = {
      id: db.tables.mensajes.length + 1, barberia_id: 928, cliente_id: cliente.id, paciente: cliente.nombre,
      texto: args.p_texto, de: args.p_de, telefono: phone, created_at: args.p_message_at,
      leido: args.p_de === 'bot', enviado_wsp: args.p_de === 'bot', estado_envio: 'aceptado', whatsapp_id: args.p_provider_message_id,
      qa_whatsapp_integration_id: args.p_integration_id, qa_whatsapp_operation_id: args.p_operation_id,
    }
    db.tables.mensajes.push(mensaje)
    return { status: 'persisted', mensaje: { ...mensaje }, cliente: { ...cliente } }
  },
}
