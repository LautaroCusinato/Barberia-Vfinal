/**
 * Pausa por atención humana (`config.bot_activo`), con la misma semántica que
 * el gate del workflow productivo (scripts/lib/whatsappManualPauseGate.mjs):
 *   * fila ausente  -> bot activo;
 *   * valor 'true'  -> activo; cualquier otro valor -> pausado;
 *   * fila de otro negocio, forma inesperada o varias filas -> error (el
 *     llamador no responde: fail closed).
 */
export function evaluateBotPause(rows, tenantId) {
  const expectedTenant = Number(tenantId)
  if (!Number.isSafeInteger(expectedTenant) || expectedTenant <= 0) throw new Error('manual_pause_tenant_invalid')
  const list = Array.isArray(rows) ? rows : []
  const present = list.filter((row) => row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).length > 0)
  for (const row of present) {
    if (!Object.prototype.hasOwnProperty.call(row, 'valor') || Number(row.barberia_id) !== expectedTenant || row.clave !== 'bot_activo') throw new Error('manual_pause_lookup_invalid')
  }
  if (present.length > 1) throw new Error('manual_pause_lookup_ambiguous')
  if (!present.length) return { botActive: true, manualPause: false, source: 'default_active' }
  const active = String(present[0].valor ?? '').trim().toLowerCase() === 'true'
  return { botActive: active, manualPause: !active, source: 'config' }
}
