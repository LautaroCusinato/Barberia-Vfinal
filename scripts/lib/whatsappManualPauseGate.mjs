// Gate de traspaso a atención humana para el workflow productivo de n8n.
//
// El panel apaga `config.bot_activo` (RPC pause_whatsapp_bot_for_manual_reply)
// cuando alguien del equipo responde a mano. El workflow productivo sólo
// miraba `automation_enabled`, así que el bot seguía contestando en paralelo.
// Este gate lee la pausa del tenant resuelto en el servidor:
//   * fila ausente  -> bot activo (mismo default que el panel y el legado);
//   * valor 'true'  -> activo; cualquier otro valor -> pausado;
//   * error o forma inesperada de la consulta -> se detiene sin responder.
// Se consulta dos veces: antes de llamar a la IA (evita costo y respuesta) y
// otra vez justo antes del outbound, para cubrir la carrera en la que una
// persona responde mientras la IA estaba generando.

export const MANUAL_PAUSE_NODE_NAMES = Object.freeze({
  lookup: 'Consultar pausa manual',
  evaluate: 'Evaluar pausa manual',
  gate: 'Bot activo para el tenant',
  finishPaused: 'Finalizar evento pausado',
  logPaused: 'Logging pausa manual',
  recheck: 'Reconsultar pausa manual',
  reevaluate: 'Evaluar pausa antes de enviar',
})

// Lógica pura compartida por los nodos Code y por las pruebas.
export const MANUAL_PAUSE_EVALUATOR = String.raw`function evaluateManualPause(rows, tenantId) {
  const expectedTenant = Number(tenantId);
  if (!Number.isSafeInteger(expectedTenant) || expectedTenant <= 0) throw new Error('manual_pause_tenant_invalid');
  const list = Array.isArray(rows) ? rows : [];
  const present = list.filter((row) => row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).length > 0);
  for (const row of present) {
    if (!Object.prototype.hasOwnProperty.call(row, 'valor') || Number(row.barberia_id) !== expectedTenant || row.clave !== 'bot_activo') throw new Error('manual_pause_lookup_invalid');
  }
  if (present.length > 1) throw new Error('manual_pause_lookup_ambiguous');
  if (!present.length) return { botActive: true, manualPause: false, source: 'default_active' };
  const active = String(present[0].valor ?? '').trim().toLowerCase() === 'true';
  return { botActive: active, manualPause: !active, source: 'config' };
}`

function evaluatorCode(lookupNodeName) {
  return `${MANUAL_PAUSE_EVALUATOR}
const tenant = $('Resolver tenant').first().json;
const rows = $('${lookupNodeName}').all().map((item) => item.json);
const result = evaluateManualPause(rows, tenant.tenant_id);
return [{ json: { ...result, tenant_id: Number(tenant.tenant_id), mutationAllowed: false } }];`
}

function lookupNode(name, id, position) {
  return {
    parameters: {
      url: "={{ $env.SUPABASE_PRODUCTION_URL + '/rest/v1/config' }}",
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'barberia_id', value: "={{ 'eq.' + $('Resolver tenant').first().json.tenant_id }}" },
          { name: 'clave', value: 'eq.bot_activo' },
          { name: 'select', value: 'barberia_id,clave,valor' },
        ],
      },
      sendHeaders: false,
      options: { timeout: 20000 },
      authentication: 'genericCredentialType',
      genericAuthType: 'httpCustomAuth',
    },
    id,
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    retryOnFail: false,
    onError: 'stopWorkflow',
    executeOnce: true,
    alwaysOutputData: true,
    notes: 'Production service credential. Reads only the server-resolved tenant pause flag (config.bot_activo). A failed lookup stops the workflow: no auto-reply.',
  }
}

function evaluateNode(name, id, position, lookupNodeName) {
  return {
    parameters: { mode: 'runOnceForAllItems', jsCode: evaluatorCode(lookupNodeName) },
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    retryOnFail: false,
    onError: 'stopWorkflow',
    notes: 'Missing row = active (panel default). Any value other than "true" = paused. Unexpected shape throws (fail closed).',
  }
}

const ifActive = (name, id, position, leftValue, notes) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ leftValue, rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
      combinator: 'and',
    },
    options: {},
  },
  id,
  name,
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position,
  notes,
})

const next = (node, index = 0) => ({ node, type: 'main', index })

/** Inserta el gate en un workflow ya generado. Idempotente. */
export function applyManualPauseGate(workflow) {
  const names = MANUAL_PAUSE_NODE_NAMES
  const byName = (name) => workflow.nodes.find((node) => node.name === name)
  if (byName(names.lookup)) return workflow

  const loaders = ['Cargar servicios bajo demanda', 'Cargar empleados bajo demanda', 'Cargar horarios y pausas', 'Cargar bloqueos']
  for (const required of ['Evento nuevo', 'Registrar propuesta minimizada', 'Outbound habilitado para conexión', 'Finalizar evento', ...loaders]) {
    if (!byName(required)) throw new Error(`manual_pause_gate_missing_node:${required}`)
  }

  workflow.nodes.push(
    lookupNode(names.lookup, 'production-manual-pause-lookup', [1440, -224]),
    evaluateNode(names.evaluate, 'production-manual-pause-evaluate', [1552, -224], names.lookup),
    ifActive(names.gate, 'production-manual-pause-gate', [1664, -224], `={{ $('${names.evaluate}').first().json.botActive === true }}`, 'False when staff took over the chat from the panel (config.bot_activo = false). Paused events are finalized without AI or outbound.'),
    {
      parameters: {
        method: 'POST',
        url: "={{ $env.SUPABASE_PRODUCTION_URL + '/rest/v1/rpc/finish_whatsapp_event' }}",
        sendHeaders: false,
        sendBody: true,
        specifyBody: 'json',
        jsonBody: "={{ JSON.stringify({ p_integration_id: $('Resolver tenant').first().json.integration_id, p_event_id: $('Validar identidad e idempotencia').first().json.eventId, p_status: 'completed', p_result_reference: 'manual_handoff_paused' }) }}",
        options: { timeout: 20000 },
        authentication: 'genericCredentialType',
        genericAuthType: 'httpCustomAuth',
      },
      id: 'production-manual-pause-finish',
      name: names.finishPaused,
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1888, -320],
      retryOnFail: false,
      onError: 'stopWorkflow',
      executeOnce: true,
      notes: 'Closes the claimed inbound event; no AI call and no outbound while a human handles the conversation.',
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: "return [{json:{stage:'manual_handoff_paused',event_id:$('Validar identidad e idempotencia').first().json.eventId,tenant_id:$('Resolver tenant').first().json.tenant_id,mode:'production-controlled',mutationAllowed:false,outboundSent:false}}];" },
      id: 'production-manual-pause-log',
      name: names.logPaused,
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2112, -320],
      notes: 'No phone, JID or message text is logged.',
    },
    lookupNode(names.recheck, 'production-manual-pause-recheck', [3540, 352]),
    evaluateNode(names.reevaluate, 'production-manual-pause-reevaluate', [3540, 448], names.recheck),
  )

  const connections = workflow.connections
  connections['Evento nuevo'].main[0] = [next(names.lookup)]
  connections[names.lookup] = { main: [[next(names.evaluate)]] }
  connections[names.evaluate] = { main: [[next(names.gate)]] }
  connections[names.gate] = { main: [loaders.map((loader) => next(loader)), [next(names.finishPaused)]] }
  connections[names.finishPaused] = { main: [[next(names.logPaused)]] }

  connections['Registrar propuesta minimizada'] = { main: [[next(names.recheck)]] }
  connections[names.recheck] = { main: [[next(names.reevaluate)]] }
  connections[names.reevaluate] = { main: [[next('Outbound habilitado para conexión')]] }

  const outboundGate = byName('Outbound habilitado para conexión')
  outboundGate.parameters.conditions.conditions[0].leftValue = `={{ $('Resolver tenant').first().json.outbound_enabled === true && $('${names.reevaluate}').first().json.botActive === true }}`
  outboundGate.notes = 'False by default. Requires the tenant-scoped outbound flag AND an active bot (no manual handoff) re-read right before sending; the inbound payload cannot enable outbound.'
  return workflow
}
