const VALID_ACCESS_STATES = new Set(['active', 'trialing', 'past_due'])
const VALID_CONNECTION_STATES = new Set([
  'NOT_CONFIGURED',
  'CREATING_INSTANCE',
  'QR_READY',
  'CONNECTING',
  'CONNECTED',
  'DISCONNECTED',
  'ERROR',
])

const statusRank = { PASS: 0, WARN: 1, FAIL: 2 }

function clean(value) {
  return String(value ?? '').trim()
}

function positiveInteger(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

function add(checks, status, code, message) {
  checks.push({ status, code, message })
}

function validTimezone(value) {
  const timezone = clean(value)
  if (!timezone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
    return true
  } catch {
    return false
  }
}
function validCurrency(value) {
  const currency = clean(value)
  if (!/^[A-Z]{3}$/.test(currency)) return false
  try {
    return Intl.supportedValuesOf('currency').includes(currency)
  } catch {
    return currency !== 'XXX'
  }
}

export function evaluateTenantPreflight(snapshot) {
  const checks = []
  const source = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {}
  const tenant = source.tenant && typeof source.tenant === 'object' && !Array.isArray(source.tenant) ? source.tenant : null
  const counts = source.counts && typeof source.counts === 'object' && !Array.isArray(source.counts) ? source.counts : {}
  const connections = Array.isArray(source.connections) ? source.connections : []
  const tenantId = positiveInteger(tenant?.id)

  if (!tenantId) {
    add(checks, 'FAIL', 'TENANT_NOT_FOUND', 'El tenant no existe o no tiene un identificador válido.')
  } else {
    add(checks, 'PASS', 'TENANT_FOUND', 'El tenant existe y tiene identidad válida.')
  }

  const name = clean(tenant?.name)
  add(checks, name ? 'PASS' : 'FAIL', name ? 'BUSINESS_NAME_READY' : 'BUSINESS_NAME_MISSING', name ? 'El nombre comercial está configurado.' : 'Falta el nombre comercial.')

  const slug = clean(tenant?.slug)
  const slugValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  add(checks, slugValid ? 'PASS' : 'FAIL', slugValid ? 'SLUG_READY' : 'SLUG_INVALID', slugValid ? 'El slug público es válido.' : 'El slug falta o no cumple el formato público seguro.')

  const timezoneValid = validTimezone(tenant?.timezone)
  add(checks, timezoneValid ? 'PASS' : 'FAIL', timezoneValid ? 'TIMEZONE_READY' : 'TIMEZONE_INVALID', timezoneValid ? 'La zona horaria es válida.' : 'La zona horaria falta o no es reconocida.')

  const currencyValid = validCurrency(tenant?.currency)
  add(checks, currencyValid ? 'PASS' : 'FAIL', currencyValid ? 'CURRENCY_READY' : 'CURRENCY_INVALID', currencyValid ? 'La moneda usa un código ISO válido.' : 'La moneda falta o no es un código ISO válido en mayúsculas.')

  const accessState = clean(tenant?.access_state).toLowerCase()
  const accessAllowed = VALID_ACCESS_STATES.has(accessState)
  const accessStatus = accessAllowed && accessState === 'past_due' ? 'WARN' : accessAllowed ? 'PASS' : 'FAIL'
  add(checks, accessStatus, accessAllowed ? (accessStatus === 'WARN' ? 'ACCESS_PAST_DUE' : 'ACCESS_READY') : 'ACCESS_BLOCKED', accessAllowed ? (accessStatus === 'WARN' ? 'El acceso está vencido pero aún dentro del estado tolerado por runtime; revisar antes del piloto.' : 'El estado de acceso permite el runtime.') : 'El estado de acceso no permite el runtime productivo.')

  add(checks, tenant?.onboarding_completed === true ? 'PASS' : 'FAIL', tenant?.onboarding_completed === true ? 'ONBOARDING_COMPLETE' : 'ONBOARDING_INCOMPLETE', tenant?.onboarding_completed === true ? 'El onboarding está completo.' : 'El onboarding todavía no está completo.')

  const ownerAdmins = positiveInteger(counts.owner_or_admin_members)
  add(checks, ownerAdmins > 0 ? 'PASS' : 'FAIL', ownerAdmins > 0 ? 'OWNER_ADMIN_READY' : 'OWNER_ADMIN_MISSING', ownerAdmins > 0 ? 'Existe al menos un owner o admin.' : 'Falta un owner o admin autorizado.')

  const activeServices = positiveInteger(counts.active_services)
  const validServices = positiveInteger(counts.valid_active_services)
  if (!activeServices) add(checks, 'FAIL', 'SERVICES_MISSING', 'No hay servicios activos.')
  else if (validServices !== activeServices) add(checks, 'FAIL', 'SERVICES_INVALID', 'Hay servicios activos sin precio o duración válidos.')
  else add(checks, 'PASS', 'SERVICES_READY', 'Todos los servicios activos tienen precio y duración válidos.')

  const activeStaff = positiveInteger(counts.active_staff)
  const staffWithService = positiveInteger(counts.active_staff_with_active_service)
  const staffWithSchedule = positiveInteger(counts.active_staff_with_schedule)
  if (!activeStaff) add(checks, 'FAIL', 'STAFF_MISSING', 'No hay barberos o profesionales activos.')
  else {
    add(checks, staffWithService === activeStaff ? 'PASS' : 'FAIL', staffWithService === activeStaff ? 'STAFF_SERVICES_READY' : 'STAFF_SERVICE_LINK_MISSING', staffWithService === activeStaff ? 'Todo el personal activo tiene servicios activos asociados.' : 'Hay personal activo sin servicios activos asociados.')
    add(checks, staffWithSchedule === activeStaff ? 'PASS' : 'FAIL', staffWithSchedule === activeStaff ? 'SCHEDULES_READY' : 'SCHEDULES_MISSING', staffWithSchedule === activeStaff ? 'Todo el personal activo tiene horarios configurados.' : 'Hay personal activo sin horarios configurados.')
  }

  const productionConnections = connections.filter((item) => clean(item?.environment).toLowerCase() === 'production')
  if (productionConnections.length > 1) {
    add(checks, 'FAIL', 'CONNECTION_CONFLICT', 'Hay más de una conexión productiva para el tenant.')
  } else if (!productionConnections.length) {
    add(checks, 'PASS', 'CONNECTION_SLOT_EMPTY', 'No existe una conexión productiva previa; el tenant puede provisionarse.')
  } else {
    const connection = productionConnections[0]
    const expectedInstance = tenantId ? `austral-prod-tenant-${tenantId}` : ''
    const actualInstance = clean(connection.instance_name)
    const identityValid = !actualInstance || actualInstance === expectedInstance
    add(checks, identityValid ? 'PASS' : 'FAIL', identityValid ? 'CONNECTION_IDENTITY_READY' : 'CONNECTION_IDENTITY_CONFLICT', identityValid ? 'La identidad de la conexión es determinística.' : 'La conexión existente pertenece a una identidad inesperada.')

    const bindingValid = connection.tenant_binding_valid === true
    add(checks, bindingValid ? 'PASS' : 'FAIL', bindingValid ? 'TENANT_BINDING_READY' : 'TENANT_BINDING_INVALID', bindingValid ? 'La conexión y la integración pertenecen al mismo tenant.' : 'La conexión y la integración no tienen un vínculo de tenant válido.')

    const modeValid = clean(connection.provisioning_mode) === 'live'
    add(checks, modeValid ? 'PASS' : 'FAIL', modeValid ? 'PROVISIONING_MODE_READY' : 'PROVISIONING_MODE_INVALID', modeValid ? 'La conexión existente usa modo live.' : 'La conexión productiva existente no usa modo live.')

    const state = clean(connection.state)
    add(checks, VALID_CONNECTION_STATES.has(state) ? 'PASS' : 'FAIL', VALID_CONNECTION_STATES.has(state) ? 'CONNECTION_STATE_VALID' : 'CONNECTION_STATE_INVALID', VALID_CONNECTION_STATES.has(state) ? 'El estado de conexión es válido.' : 'El estado de conexión no pertenece a la máquina de estados permitida.')
  }

  const enabledFlags = productionConnections.flatMap((connection) => ['automation_enabled', 'outbound_enabled', 'booking_enabled'].filter((flag) => connection?.[flag] === true))
  add(checks, enabledFlags.length ? 'FAIL' : 'PASS', enabledFlags.length ? 'FLAGS_UNEXPECTEDLY_ENABLED' : 'FLAGS_DEFAULT_OFF', enabledFlags.length ? 'Hay capacidades productivas habilitadas antes del gate humano.' : 'Automatización, outbound y booking permanecen deshabilitados.')

  const overall = checks.reduce((current, check) => statusRank[check.status] > statusRank[current] ? check.status : current, 'PASS')
  return {
    schema_version: 1,
    mode: 'LOCAL_READ_ONLY_SNAPSHOT',
    tenant_id: tenantId || null,
    status: overall,
    summary: {
      pass: checks.filter((check) => check.status === 'PASS').length,
      warn: checks.filter((check) => check.status === 'WARN').length,
      fail: checks.filter((check) => check.status === 'FAIL').length,
    },
    checks,
    provisioning_allowed: overall !== 'FAIL',
  }
}
